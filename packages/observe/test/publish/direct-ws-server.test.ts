import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createDirectFanout } from "#pipeline/publish/sinks/direct/fanout.js";
import {
  createWsDirectViewerServer,
  type DirectServerHandle
} from "#pipeline/publish/sinks/direct/transport.js";

/**
 * Real WS round-trip on loopback: the broadcaster's viewer server speaks the byte-identical tagged
 * protocol the host watch leg speaks (0x01 init / 0x02 fragment / JSON end), so the app player
 * works unchanged against a direct door.
 */

const FRAME_INIT = 0x01;
const FRAME_FRAGMENT = 0x02;

let server: DirectServerHandle | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

interface Received {
  binary: Array<{ tag: number; body: number[] }>;
  control: Array<Record<string, unknown>>;
  closed: Promise<{ code: number }>;
}

const connect = (port: number, streamId: string): Promise<{ ws: WebSocket; received: Received }> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/live/watch/${encodeURIComponent(streamId)}`);
    const received: Received = {
      binary: [],
      control: [],
      closed: new Promise((r) => ws.once("close", (code) => r({ code })))
    };
    ws.binaryType = "nodebuffer";
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        const buf = data as Buffer;
        received.binary.push({ tag: buf[0]!, body: [...buf.subarray(1)] });
      } else {
        received.control.push(JSON.parse(String(data)) as Record<string, unknown>);
      }
    });
    ws.once("open", () => resolve({ ws, received }));
    ws.once("error", reject);
  });

const waitFor = async (predicate: () => boolean, timeoutMs = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("direct WS viewer server", () => {
  it("serves init + fragments as tagged frames and ends with the JSON end signal", async () => {
    const fanout = createDirectFanout({ maxViewers: 2, ringFragments: 8, ringBytes: 1 << 20, viewerBacklog: 8 });
    server = await createWsDirectViewerServer({ port: 0, streamId: "m1", fanout });

    fanout.setInit(new Uint8Array([9, 9]));
    fanout.push({ seq: 1, data: new Uint8Array([1]) });

    const { received } = await connect(server.port, "m1");
    await waitFor(() => received.binary.length >= 2);
    expect(received.binary[0]).toEqual({ tag: FRAME_INIT, body: [9, 9] });
    expect(received.binary[1]).toEqual({ tag: FRAME_FRAGMENT, body: [1] });

    fanout.push({ seq: 2, data: new Uint8Array([2]) });
    await waitFor(() => received.binary.length >= 3);
    expect(received.binary[2]).toEqual({ tag: FRAME_FRAGMENT, body: [2] });

    fanout.end("stream_ended");
    await waitFor(() => received.control.length >= 1);
    expect(received.control[0]).toEqual({ type: "end", reason: "stream_ended" });
    expect((await received.closed).code).toBe(1000);
  });

  it("refuses viewers beyond the cap with an honest at_capacity", async () => {
    const fanout = createDirectFanout({ maxViewers: 1, ringFragments: 8, ringBytes: 1 << 20, viewerBacklog: 8 });
    server = await createWsDirectViewerServer({ port: 0, streamId: "m1", fanout });

    await connect(server.port, "m1");
    const second = await connect(server.port, "m1");
    await waitFor(() => second.received.control.length >= 1);
    expect(second.received.control[0]).toEqual({ type: "error", reason: "at_capacity" });
    expect((await second.received.closed).code).toBe(1013);
  });

  it("rejects a viewer asking for a different stream", async () => {
    const fanout = createDirectFanout({ maxViewers: 2, ringFragments: 8, ringBytes: 1 << 20, viewerBacklog: 8 });
    server = await createWsDirectViewerServer({ port: 0, streamId: "m1", fanout });

    const { received } = await connect(server.port, "other");
    await waitFor(() => received.control.length >= 1);
    expect(received.control[0]).toEqual({ type: "error", reason: "unknown_stream" });
    expect((await received.closed).code).toBe(1008);
    expect(fanout.viewerCount()).toBe(0);
  });

  it("frees the slot when a viewer disconnects", async () => {
    const fanout = createDirectFanout({ maxViewers: 1, ringFragments: 8, ringBytes: 1 << 20, viewerBacklog: 8 });
    server = await createWsDirectViewerServer({ port: 0, streamId: "m1", fanout });

    const first = await connect(server.port, "m1");
    await waitFor(() => fanout.viewerCount() === 1);
    first.ws.close();
    await waitFor(() => fanout.viewerCount() === 0);

    const second = await connect(server.port, "m1");
    await waitFor(() => fanout.viewerCount() === 1);
    expect(second.received.control).toHaveLength(0);
  });
});
