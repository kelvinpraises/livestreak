import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { attachLiveWss } from "../src/infrastructure/ws/live-server.js";
import { createLiveRingStore } from "../src/services/live/ring.js";

/**
 * Live fMP4 fan-out over REAL sockets: a producer ingests init + fragments over /live/ingest, a viewer
 * connects to /live/watch and receives init + backlog + live fragments, and a clean end signal closes it.
 */

const FRAME_INIT = 0x01;
const FRAME_FRAGMENT = 0x02;
const FRAME_END = 0x03;

const frame = (tag: number, body?: Uint8Array): Uint8Array => {
  const out = new Uint8Array(1 + (body?.length ?? 0));
  out[0] = tag;
  if (body) out.set(body, 1);
  return out;
};

const open = (ws: WebSocket): Promise<void> => new Promise((r) => ws.once("open", () => r()));

describe("live WSS fan-out (real sockets)", () => {
  let server: Server;
  let port: number;
  let handle: ReturnType<typeof attachLiveWss>;

  beforeEach(async () => {
    const ring = createLiveRingStore();
    server = createServer();
    handle = attachLiveWss(server, ring);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    handle.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("fans producer init + fragments out to a viewer and ends cleanly", async () => {
    const base = `ws://127.0.0.1:${port}`;
    const streamId = "market1";

    const producer = new WebSocket(`${base}/live/ingest/${streamId}`);
    await open(producer);
    producer.send(frame(FRAME_INIT, new Uint8Array([9, 9])));
    producer.send(frame(FRAME_FRAGMENT, new Uint8Array([1])));
    // Let the ring absorb the ingest before the viewer joins (so it lands in the backlog).
    await new Promise((r) => setTimeout(r, 30));

    const viewer = new WebSocket(`${base}/live/watch/${streamId}`);
    viewer.binaryType = "arraybuffer";
    const received: Array<{ tag: number; body: number[] } | { end: string | undefined }> = [];
    let endResolve!: () => void;
    const ended = new Promise<void>((r) => (endResolve = r));
    viewer.on("message", (data, isBinary) => {
      if (isBinary) {
        const buf = new Uint8Array(data as ArrayBuffer);
        received.push({ tag: buf[0]!, body: [...buf.subarray(1)] });
      } else {
        const msg = JSON.parse(data.toString()) as { type: string; reason?: string };
        if (msg.type === "end") {
          received.push({ end: msg.reason });
          endResolve();
        }
      }
    });
    await open(viewer);
    // Late-join prime: init + the one buffered fragment.
    await new Promise((r) => setTimeout(r, 30));

    // A live fragment after join tails through.
    producer.send(frame(FRAME_FRAGMENT, new Uint8Array([2])));
    await new Promise((r) => setTimeout(r, 30));

    producer.send(frame(FRAME_END, new TextEncoder().encode("done")));
    await ended;

    const tags = received.filter((r): r is { tag: number; body: number[] } => "tag" in r);
    expect(tags[0]).toEqual({ tag: FRAME_INIT, body: [9, 9] });
    expect(tags.filter((t) => t.tag === FRAME_FRAGMENT).map((t) => t.body[0])).toEqual([1, 2]);
    expect(received.at(-1)).toEqual({ end: "done" });

    producer.close();
  }, 10000);

  it("closes viewers when the producer drops without an end", async () => {
    const base = `ws://127.0.0.1:${port}`;
    const streamId = "market2";
    const producer = new WebSocket(`${base}/live/ingest/${streamId}`);
    await open(producer);
    producer.send(frame(FRAME_INIT, new Uint8Array([1])));
    await new Promise((r) => setTimeout(r, 20));

    const viewer = new WebSocket(`${base}/live/watch/${streamId}`);
    await open(viewer);
    const closed = new Promise<void>((r) => viewer.once("close", () => r()));

    // Producer vanishes without an end frame → the viewer must be told the feed closed.
    producer.close();
    await closed;
    expect(viewer.readyState).toBe(WebSocket.CLOSED);
  }, 10000);
});
