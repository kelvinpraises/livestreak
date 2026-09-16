import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  createHostFmp4IngestTransport,
  FMP4_FRAME_END,
  FMP4_FRAME_FRAGMENT,
  FMP4_FRAME_INIT,
  type WebSocketLike
} from "#pipeline/publish/sinks/live/transport.js";

/**
 * Host ingest transport: URL derivation, queue-before-open then flush-on-open, synchronous fire-and-forget
 * sends, tagged framing, and onError surfacing.
 */

interface FakeSocket extends WebSocketLike {
  readonly sent: Uint8Array[];
  fireOpen: () => void;
  fireError: (err: Error) => void;
  closedWith?: { code?: number; reason?: string };
}

const makeFakeSocket = (startOpen: boolean): { socket: FakeSocket; urlSeen: () => string } => {
  const listeners: Record<string, Array<(arg?: unknown) => void>> = {};
  const sent: Uint8Array[] = [];
  const socket: FakeSocket = {
    sent,
    readyState: startOpen ? 1 : 0,
    send: (data) => sent.push(data),
    close: (code, reason) => {
      socket.closedWith = { code, reason };
    },
    on: (event, listener) => {
      ;(listeners[event] ??= []).push(listener);
    },
    fireOpen: () => {
      ;(socket as { readyState: number }).readyState = 1;
      for (const l of listeners["open"] ?? []) l();
    },
    fireError: (err) => {
      for (const l of listeners["error"] ?? []) l(err);
    }
  };
  return { socket, urlSeen: () => "" };
};

const flushMicrotasks = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("host fMP4 ingest transport", () => {
  it("queues frames before open, flushes in order on open, and tags them", async () => {
    const { socket } = makeFakeSocket(false);
    let seenUrl = "";
    const transport = createHostFmp4IngestTransport({
      baseUrl: "http://127.0.0.1:8787",
      streamId: "market x",
      webSocketFactory: (url) => {
        seenUrl = url;
        return socket;
      }
    });

    transport.sendInit(new Uint8Array([1, 2]));
    transport.sendFragment(new Uint8Array([3]));
    await flushMicrotasks(); // let the lazy async factory resolve
    expect(seenUrl).toBe("ws://127.0.0.1:8787/live/ingest/market%20x");
    // Nothing flushed until open.
    expect(socket.sent.length).toBe(0);

    socket.fireOpen();
    expect(socket.sent.map((f) => f[0])).toEqual([FMP4_FRAME_INIT, FMP4_FRAME_FRAGMENT]);
    expect([...socket.sent[0]!.subarray(1)]).toEqual([1, 2]);
    expect([...socket.sent[1]!.subarray(1)]).toEqual([3]);
  });

  it("sends synchronously once open, and end tags + closes", async () => {
    const { socket } = makeFakeSocket(true); // already open
    const transport = createHostFmp4IngestTransport({
      baseUrl: "https://host",
      streamId: "s",
      webSocketFactory: () => socket
    });
    transport.sendFragment(new Uint8Array([9]));
    await flushMicrotasks();
    expect(socket.sent.at(-1)![0]).toBe(FMP4_FRAME_FRAGMENT);

    await Effect.runPromise(transport.end("done"));
    // end tags an END frame then closes.
    expect(socket.sent.some((f) => f[0] === FMP4_FRAME_END)).toBe(true);
    expect(socket.closedWith?.code).toBe(1000);
  });

  it("surfaces a socket error to onError listeners", async () => {
    const { socket } = makeFakeSocket(false);
    const transport = createHostFmp4IngestTransport({
      baseUrl: "http://h",
      streamId: "s",
      webSocketFactory: () => socket
    });
    const errors: string[] = [];
    transport.onError((e) => errors.push(e.message));
    transport.sendInit(new Uint8Array([1]));
    await flushMicrotasks();
    socket.fireError(new Error("boom"));
    expect(errors).toContain("boom");
  });
});
