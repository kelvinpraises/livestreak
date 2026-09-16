import { describe, expect, it } from "vitest";
import {
  createLiveRingStore,
  type LiveRingConfig,
  type ViewerFrame
} from "../src/services/live/ring.js";

/**
 * Live fMP4 ring buffer + fan-out semantics: init caching, late-join backlog, slow-viewer drop-oldest
 * skip-forward, and the clean end signal. No sockets — drives the store's ViewerSink directly.
 */

const bytes = (...n: number[]): Uint8Array => new Uint8Array(n);

const collect = (): { sink: (f: ViewerFrame) => void; frames: ViewerFrame[] } => {
  const frames: ViewerFrame[] = [];
  return { sink: (f) => frames.push(f), frames };
};

const smallConfig: LiveRingConfig = { maxFragments: 3, maxBytes: 1_000, viewerQueue: 2 };

describe("live ring buffer", () => {
  it("primes a late joiner with init + the current backlog then live-tails", () => {
    const ring = createLiveRingStore(smallConfig);
    ring.setInit("s", bytes(0));
    ring.pushFragment("s", bytes(1));
    ring.pushFragment("s", bytes(2));

    const v = collect();
    ring.addViewer("s", "v1", v.sink);
    // Late joiner: init first, then the two buffered fragments.
    expect(v.frames.map((f) => f.kind)).toEqual(["init", "fragment", "fragment"]);

    // Then a new fragment live-tails to the attached viewer.
    ring.pushFragment("s", bytes(3));
    expect(v.frames.at(-1)).toEqual({ kind: "fragment", data: bytes(3) });
  });

  it("caches init and re-primes existing viewers on a fresh init (reconnect)", () => {
    const ring = createLiveRingStore(smallConfig);
    ring.setInit("s", bytes(9));
    const v = collect();
    ring.addViewer("s", "v1", v.sink);
    expect(v.frames[0]).toEqual({ kind: "init", data: bytes(9) });

    // Producer reconnects with a new init → the live viewer gets it again so MSE re-inits.
    ring.setInit("s", bytes(10));
    expect(v.frames.at(-1)).toEqual({ kind: "init", data: bytes(10) });
  });

  it("evicts oldest fragments past the fragment cap", () => {
    const ring = createLiveRingStore(smallConfig); // maxFragments 3
    ring.setInit("s", bytes(0));
    for (let i = 1; i <= 5; i += 1) ring.pushFragment("s", bytes(i));

    const v = collect();
    ring.addViewer("s", "v1", v.sink);
    // Only the last 3 fragments remain in the backlog (3,4,5).
    const fragments = v.frames.filter((f) => f.kind === "fragment") as { data: Uint8Array }[];
    expect(fragments.map((f) => f.data[0])).toEqual([3, 4, 5]);
  });

  it("skips a slow viewer forward instead of stalling the stream (drop-oldest)", () => {
    // A viewer whose cursor falls more than viewerQueue behind is skipped forward. Here we only assert the
    // stream keeps flowing to it and never throws — the sink still receives live fragments after the skip.
    const ring = createLiveRingStore(smallConfig);
    ring.setInit("s", bytes(0));
    const v = collect();
    ring.addViewer("s", "v1", v.sink);
    for (let i = 1; i <= 20; i += 1) ring.pushFragment("s", bytes(i & 0xff));
    // The viewer received init + 20 live fragments (fan-out is push-through; the skip logic only advances
    // the cursor, it never drops the CURRENT fragment).
    const fragments = v.frames.filter((f) => f.kind === "fragment");
    expect(fragments.length).toBe(20);
    expect(ring.viewerCount("s")).toBe(1);
  });

  it("sends a clean end signal to viewers and reports not-live", () => {
    const ring = createLiveRingStore(smallConfig);
    ring.setInit("s", bytes(0));
    const v = collect();
    ring.addViewer("s", "v1", v.sink);
    expect(ring.isLive("s")).toBe(true);

    ring.end("s", "done");
    expect(v.frames.at(-1)).toEqual({ kind: "end", reason: "done" });
    expect(ring.isLive("s")).toBe(false);

    // A viewer joining AFTER the end still gets init + backlog + the end signal.
    const late = collect();
    ring.addViewer("s", "v2", late.sink);
    expect(late.frames.at(-1)!.kind).toBe("end");
  });

  it("a dead viewer sink never breaks fan-out to others", () => {
    const ring = createLiveRingStore(smallConfig);
    ring.setInit("s", bytes(0));
    ring.addViewer("s", "dead", () => {
      throw new Error("socket closed");
    });
    const ok = collect();
    ring.addViewer("s", "ok", ok.sink);
    expect(() => ring.pushFragment("s", bytes(1))).not.toThrow();
    expect(ok.frames.some((f) => f.kind === "fragment")).toBe(true);
  });

  it("clear tells viewers the stream closed and forgets it", () => {
    const ring = createLiveRingStore(smallConfig);
    ring.setInit("s", bytes(0));
    const v = collect();
    ring.addViewer("s", "v1", v.sink);
    ring.clear("s");
    expect(v.frames.at(-1)!.kind).toBe("end");
    expect(ring.viewerCount("s")).toBe(0);
    expect(ring.isLive("s")).toBe(false);
  });
});
