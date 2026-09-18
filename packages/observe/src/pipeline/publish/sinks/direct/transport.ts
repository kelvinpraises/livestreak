// Broadcaster-side viewer server: viewers dial the BROADCASTER (ws://<public>/live/watch/:streamId) and
// receive the same tagged fMP4 frames the host watch leg serves — byte-identical wire, so the app's MSE
// player works unchanged with a different URL. The host carries zero media bytes. `ws` is loaded lazily
// (Node only), same posture as the live sink's ingest transport, so observe's barrel stays browser-safe.
//
// The QUIC/WebTransport punch lane drops in behind the same DirectServerFactory seam when the Node QUIC
// stack allows serving on an externally punched socket.

import { FMP4_FRAME_FRAGMENT, FMP4_FRAME_INIT } from "#pipeline/publish/sinks/live/transport.js";
import type { DirectFanout, DirectViewerFrame } from "./fanout.js";

export interface DirectServeInput {
  readonly port: number;
  readonly streamId: string;
  readonly fanout: DirectFanout;
}

export interface DirectServerHandle {
  /** The actually bound port (differs from the requested one only when 0 was asked for). */
  readonly port: number;
  readonly close: () => Promise<void>;
}

export type DirectServerFactory = (input: DirectServeInput) => Promise<DirectServerHandle>;

/** Builds a viewer watch URL in the exact shape the app player derives from a host base URL. */
export const directWatchUrl = (host: string, port: number, streamId: string): string =>
  `ws://${host}:${port}/live/watch/${encodeURIComponent(streamId)}`;

interface WsLikeSocket {
  readonly send: (data: unknown, cb?: (err?: Error | null) => void) => void;
  readonly close: (code?: number, reason?: string) => void;
  readonly on: (event: string, listener: (...args: unknown[]) => void) => void;
  readonly readyState: number;
  binaryType: string;
}

interface WsLikeServer {
  readonly on: (event: string, listener: (...args: unknown[]) => void) => void;
  readonly close: (cb?: () => void) => void;
  readonly address: () => { port: number } | string | null;
  readonly clients: Set<unknown>;
}

const WS_OPEN = 1;

// Every viewer receives the SAME bytes — tag each fragment once and share the buffer across the
// fan-out instead of memcpy'ing it per viewer (init and fragments are distinct objects, so keying
// the cache on the body alone is safe).
const tagCache = new WeakMap<Uint8Array, Uint8Array>();

const tagFrame = (tag: number, body: Uint8Array): Uint8Array => {
  const cached = tagCache.get(body);
  if (cached !== undefined) return cached;
  const out = new Uint8Array(1 + body.byteLength);
  out[0] = tag;
  out.set(body, 1);
  tagCache.set(body, out);
  return out;
};

export const createWsDirectViewerServer: DirectServerFactory = async (input) => {
  const { WebSocketServer } = (await import(/* @vite-ignore */ "ws")) as {
    WebSocketServer: new (opts: { port: number }) => WsLikeServer;
  };
  const wss = new WebSocketServer({ port: input.port });

  await new Promise<void>((resolve, reject) => {
    wss.on("listening", () => resolve());
    wss.on("error", (err) => reject(err instanceof Error ? err : new Error(String(err))));
  });

  let nextViewer = 0;

  wss.on("connection", (...args) => {
    const ws = args[0] as WsLikeSocket;
    const req = args[1] as { url?: string } | undefined;
    ws.binaryType = "nodebuffer";

    const streamId = parseWatchStreamId(req?.url ?? "");
    if (streamId !== input.streamId) {
      ws.send(JSON.stringify({ type: "error", reason: "unknown_stream" }));
      ws.close(1008, "unknown_stream");
      return;
    }

    const viewerId = `direct-${++nextViewer}`;
    const write = (frame: DirectViewerFrame): Promise<void> => {
      if (ws.readyState !== WS_OPEN) return Promise.reject(new Error("viewer socket closed"));
      if (frame.kind === "end") {
        ws.send(JSON.stringify({ type: "end", reason: frame.reason }));
        ws.close(1000, "stream_ended");
        return Promise.resolve();
      }
      const tag = frame.kind === "init" ? FMP4_FRAME_INIT : FMP4_FRAME_FRAGMENT;
      return new Promise((resolve, reject) => {
        // `ws` reports success as cb(null) — only a truthy err is a failed send.
        ws.send(tagFrame(tag, frame.data), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    };

    const admitted = input.fanout.admit({
      id: viewerId,
      write,
      close: () => {
        try {
          ws.close(1000);
        } catch {
          /* already gone */
        }
      }
    });

    if (!admitted.ok) {
      // Honest refusal: bandwidth is the broadcaster's only scarcity, and it is capped.
      ws.send(JSON.stringify({ type: "error", reason: admitted.reason }));
      ws.close(1013, admitted.reason);
      return;
    }

    ws.on("close", () => input.fanout.remove(viewerId));
    ws.on("error", () => {
      input.fanout.remove(viewerId);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    });
  });

  const bound = wss.address();
  const port = typeof bound === "object" && bound !== null ? bound.port : input.port;

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        // Terminate lingering viewer sockets so close() cannot hang on a slow client.
        for (const client of wss.clients) {
          try {
            (client as WsLikeSocket).close(1001, "server_closing");
          } catch {
            /* ignore */
          }
        }
        wss.close(() => resolve());
      })
  };
};

// --- helpers ---

const parseWatchStreamId = (url: string): string | undefined => {
  const pathname = url.split("?")[0] ?? "";
  const segments = pathname.split("/").filter((s) => s.length > 0);
  // ["live", "watch", "<streamId>"] — the exact host watch path shape.
  if (segments.length !== 3 || segments[0] !== "live" || segments[1] !== "watch") return undefined;
  const streamId = decodeURIComponent(segments[2]!);
  return streamId.length === 0 ? undefined : streamId;
};
