import { describe, expect, it } from "vitest";
import {
  createDirectFanout,
  type DirectViewer,
  type DirectViewerFrame
} from "#pipeline/publish/sinks/direct/fanout.js";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

const makeViewer = (
  id: string,
  writeDelayMs = 0
): { viewer: DirectViewer; frames: DirectViewerFrame[]; closed: { value: boolean } } => {
  const frames: DirectViewerFrame[] = [];
  const closed = { value: false };
  const viewer: DirectViewer = {
    id,
    write: async (frame) => {
      if (writeDelayMs > 0) await new Promise((r) => setTimeout(r, writeDelayMs));
      frames.push(frame);
    },
    close: () => {
      closed.value = true;
    }
  };
  return { viewer, frames, closed };
};

const bytes = (n: number): Uint8Array => new Uint8Array([n]);

describe("direct fan-out", () => {
  it("primes a late joiner with init + ring backlog, then live-tails", async () => {
    const fanout = createDirectFanout({ maxViewers: 4, ringFragments: 3, ringBytes: 1024, viewerBacklog: 8 });
    fanout.setInit(bytes(0));
    fanout.push({ seq: 1, data: bytes(1) });
    fanout.push({ seq: 2, data: bytes(2) });

    const { viewer, frames } = makeViewer("late");
    expect(fanout.admit(viewer).ok).toBe(true);
    await tick();
    fanout.push({ seq: 3, data: bytes(3) });
    await tick();

    expect(frames.map((f) => f.kind)).toEqual(["init", "fragment", "fragment", "fragment"]);
    expect(frames.filter((f) => f.kind === "fragment").map((f) => (f as { seq: number }).seq)).toEqual([
      1, 2, 3
    ]);
  });

  it("caps the ring by fragment count", async () => {
    const fanout = createDirectFanout({ maxViewers: 4, ringFragments: 2, ringBytes: 1024, viewerBacklog: 8 });
    fanout.setInit(bytes(0));
    for (let i = 1; i <= 5; i++) fanout.push({ seq: i, data: bytes(i) });

    const { viewer, frames } = makeViewer("late");
    fanout.admit(viewer);
    await tick();
    // Only the last 2 fragments survive the ring.
    expect(frames.filter((f) => f.kind === "fragment").map((f) => (f as { seq: number }).seq)).toEqual([
      4, 5
    ]);
  });

  it("refuses viewer N+1 with an honest at_capacity", () => {
    const fanout = createDirectFanout({ maxViewers: 1, ringFragments: 2, ringBytes: 1024, viewerBacklog: 8 });
    expect(fanout.admit(makeViewer("a").viewer)).toEqual({ ok: true });
    expect(fanout.admit(makeViewer("b").viewer)).toEqual({ ok: false, reason: "at_capacity" });
    expect(fanout.viewerCount()).toBe(1);
  });

  it("drops backlog and skips a slow viewer forward — live means live", async () => {
    const fanout = createDirectFanout({ maxViewers: 2, ringFragments: 32, ringBytes: 1 << 20, viewerBacklog: 2 });
    fanout.setInit(bytes(0));
    const slow = makeViewer("slow", 15);
    fanout.admit(slow.viewer);
    await tick(); // init lands

    for (let i = 1; i <= 8; i++) fanout.push({ seq: i, data: bytes(i) });
    await new Promise((r) => setTimeout(r, 250));

    const seqs = slow.frames.filter((f) => f.kind === "fragment").map((f) => (f as { seq: number }).seq);
    // The slow viewer must NOT have received all 8 — backlog beyond 2 was dropped — and must end at the tip.
    expect(seqs.length).toBeLessThan(8);
    expect(seqs[seqs.length - 1]).toBe(8);
  });

  it("ends every viewer and refuses admits after end", async () => {
    const fanout = createDirectFanout({ maxViewers: 2, ringFragments: 2, ringBytes: 1024, viewerBacklog: 8 });
    const a = makeViewer("a");
    fanout.admit(a.viewer);
    await tick();
    fanout.end("stream_ended");
    await tick();

    expect(a.frames.at(-1)).toEqual({ kind: "end", reason: "stream_ended" });
    expect(a.closed.value).toBe(true);
    expect(fanout.admit(makeViewer("late").viewer)).toEqual({ ok: false, reason: "ended" });
  });

  it("drained() resolves only after every viewer pipeline shipped its queue + end signal", async () => {
    const fanout = createDirectFanout({ maxViewers: 2, ringFragments: 8, ringBytes: 1024, viewerBacklog: 8 });
    fanout.setInit(bytes(0));
    const slow = makeViewer("slow", 10);
    fanout.admit(slow.viewer);
    await tick();
    fanout.push({ seq: 1, data: bytes(1) });
    fanout.push({ seq: 2, data: bytes(2) });

    let drainedResolved = false;
    const drained = fanout.drained().then(() => {
      drainedResolved = true;
    });
    fanout.end("stream_ended");
    // The slow viewer still has queued fragments — drain must NOT have resolved yet.
    expect(drainedResolved).toBe(false);
    await drained;

    expect(slow.frames.filter((f) => f.kind === "fragment").map((f) => (f as { seq: number }).seq)).toEqual([1, 2]);
    expect(slow.frames.at(-1)).toEqual({ kind: "end", reason: "stream_ended" });
  });

  it("drained() resolves immediately when end() finds no viewers", async () => {
    const fanout = createDirectFanout({ maxViewers: 2, ringFragments: 2, ringBytes: 1024, viewerBacklog: 8 });
    fanout.end();
    await fanout.drained();
  });
});
