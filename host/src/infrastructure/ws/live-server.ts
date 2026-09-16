import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { LiveRingStore, ViewerFrame } from "../../services/live/ring.js";

// --- Live fMP4 fan-out transport (P2) ---
//
// Two WS legs share the Express http.Server via `noServer` upgrades:
//   leg A  ws://<host>/live/ingest/:streamId   (producer; ONE encode-once stream in)
//   leg B  ws://<host>/live/watch/:streamId    (viewer; init + backlog then live-tail out)
//
// WS (not chunked HTTP) because each leg is a single long-lived binary connection carrying a continuous
// fragment flow, and the browser viewer appends each binary frame straight into an MSE SourceBuffer as it
// arrives — a persistent socket is the natural fit and sidesteps chunked-HTTP flush/backpressure quirks.
//
// Auth posture mirrors the existing /webrtc signaling relay: the live media relay is an always-on,
// stream-key-scoped surface (no module token, no producer token) — the same open posture the WebRTC
// signaling had, keyed by the market id the viewer already knows. Fine-grained producer auth is a
// follow-up if this relay ever leaves the trusted dev/host boundary.

export interface LiveWssHandle {
  readonly wss: WebSocketServer;
  readonly close: () => void;
}

// 1-byte frame tags on the ingest socket (must match observe's live transport framing).
const FRAME_INIT = 0x01;
const FRAME_FRAGMENT = 0x02;
const FRAME_END = 0x03;

export const attachLiveWss = (server: HttpServer, ring: LiveRingStore): LiveWssHandle => {
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const route = parseLivePath(req.url ?? "");
    // Not a /live path → leave the socket for another upgrade listener (e.g. the remote WSS). The shared
    // final rejecter (main.ts) 404s a truly unmatched upgrade; we must NOT destroy a peer's socket here.
    if (route === null) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (route.leg === "ingest") {
        handleIngest(ws, route.streamId);
      } else {
        handleWatch(ws, route.streamId);
      }
    });
  };

  // Producer: one encode-once stream. Each binary message is a tagged frame; route it into the ring.
  const handleIngest = (ws: WebSocket, streamId: string): void => {
    ws.binaryType = "nodebuffer";
    let ended = false;
    ws.on("message", (data, isBinary) => {
      if (!isBinary) return;
      const buf = toUint8(data);
      if (buf.length === 0) return;
      const tag = buf[0]!;
      const body = buf.subarray(1);
      if (tag === FRAME_INIT) {
        ring.setInit(streamId, copyOut(body));
      } else if (tag === FRAME_FRAGMENT) {
        ring.pushFragment(streamId, copyOut(body));
      } else if (tag === FRAME_END) {
        ended = true;
        ring.end(streamId, body.length > 0 ? new TextDecoder().decode(body) : undefined);
      }
    });
    // Producer dropped without a clean end → tell viewers the feed closed and drop the stream.
    ws.on("close", () => {
      if (!ended) ring.clear(streamId);
    });
    ws.on("error", () => ws.close());
  };

  // Viewer: primed with init + backlog then live-tailed. Frames are sent as tagged binary the browser MSE
  // player demuxes (init vs fragment) plus a JSON end signal.
  const handleWatch = (ws: WebSocket, streamId: string): void => {
    const viewerId = randomUUID();
    const sink = (frame: ViewerFrame): void => {
      if (ws.readyState !== ws.OPEN) return;
      if (frame.kind === "end") {
        ws.send(JSON.stringify({ type: "end", reason: frame.reason }));
        ws.close(1000, "stream_ended");
        return;
      }
      const tag = frame.kind === "init" ? FRAME_INIT : FRAME_FRAGMENT;
      const out = new Uint8Array(1 + frame.data.byteLength);
      out[0] = tag;
      out.set(frame.data, 1);
      ws.send(out);
    };
    const detach = ring.addViewer(streamId, viewerId, sink);
    ws.on("close", detach);
    ws.on("error", () => ws.close());
  };

  server.on("upgrade", onUpgrade);

  const close = (): void => {
    server.off("upgrade", onUpgrade);
    wss.close();
  };

  return { wss, close };
};

// --- helpers ---

interface LiveRoute {
  readonly streamId: string;
  readonly leg: "ingest" | "watch";
}

const parseLivePath = (url: string): LiveRoute | null => {
  const pathname = url.split("?")[0] ?? "";
  const segments = pathname.split("/").filter((s) => s.length > 0);
  // ["live", "ingest" | "watch", "<streamId>"]
  if (segments.length !== 3 || segments[0] !== "live") return null;
  const leg = segments[1];
  if (leg !== "ingest" && leg !== "watch") return null;
  const streamId = decodeURIComponent(segments[2]!);
  if (streamId.length === 0) return null;
  return { streamId, leg };
};

// `ws` delivers a binary message as Buffer | ArrayBuffer | Buffer[] depending on config; normalize.
const toUint8 = (data: unknown): Uint8Array => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) {
    const parts = data as Uint8Array[];
    const size = parts.reduce((n, p) => n + p.byteLength, 0);
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.byteLength;
    }
    return out;
  }
  return new Uint8Array(0);
};

// The ring retains fragments; a `ws` Buffer view aliases a pooled buffer, so copy before storing.
const copyOut = (view: Uint8Array): Uint8Array => {
  const out = new Uint8Array(view.byteLength);
  out.set(view);
  return out;
};
