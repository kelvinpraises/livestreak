import { Chunk, Effect, Fiber, Queue, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { nowTimePoint } from "@livestreak/schema";
import type { RawFrame } from "#pipeline/capture/index.js";
import { createCaptureFramePull } from "#run/worker/capture-pull.js";
import { createWorkerBoardWake } from "#run/worker/wake.js";

describe("capture frame pull", () => {
  it("advances a single stream consumer without re-subscribing", async () => {
    let produced = 0;
    const frames = Stream.range(0, 3).pipe(
      Stream.map((index) => {
        produced += 1;
        return makeFrame(index);
      }),
    );

    // Consume inside the owning scope: the pull retains its upstream take in that scope.
    const ids = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pull = yield* createCaptureFramePull(frames);
          const out: Array<string | undefined> = [];
          for (let index = 0; index < 5; index += 1) {
            out.push((yield* pull.pullNext())?.id);
          }
          return out;
        })
      )
    );

    expect(ids).toEqual(["frame:0", "frame:1", "frame:2", "frame:3", undefined]);
    expect(produced).toBe(4);
  });

  it("buffers frames when the source emits chunks larger than one", async () => {
    const frames = Stream.fromIterable([0, 1, 2, 3]).pipe(
      Stream.rechunk(2),
      Stream.map((index) => makeFrame(index)),
    );
    // Consume inside the owning scope: the pull retains its upstream take in that scope.
    const values = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const pull = yield* createCaptureFramePull(frames);
          const out: string[] = [];
          for (let index = 0; index < 5; index += 1) {
            const frame = yield* pull.pullNext();
            if (frame === undefined) {
              out.push("end");
              break;
            }
            out.push(frame.id);
          }
          return out;
        })
      )
    );

    expect(values).toEqual(["frame:0", "frame:1", "frame:2", "frame:3", "end"]);
    expect(values).toEqual(["frame:0", "frame:1", "frame:2", "frame:3", "end"]);
  });
});

describe("control-aware capture pull", () => {
  it("a wake wins a quiet pull without consuming media", async () => {
    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const wake = yield* createWorkerBoardWake();
          const queue = yield* Queue.bounded<RawFrame>(4);
          const pull = yield* createCaptureFramePull(Stream.fromQueue(queue));
          const fiber = yield* Effect.fork(pull.pullNextAware!(wake));
          yield* Effect.yieldNow();
          yield* wake.notify();
          const first = yield* Fiber.join(fiber);
          expect(first._tag).toBe("wake");
          // The pending pull survived: the next frame still arrives through it.
          yield* Queue.offer(queue, makeFrame(9));
          const second = yield* pull.pullNextAware!(wake);
          return second._tag === "frame" ? second.frame.id : second._tag;
        })
      )
    );

    expect(seen).toBe("frame:9");
  });

  it("empty chunks are skipped inside the pull: frame, then genuine end", async () => {
    const tags = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const wake = yield* createWorkerBoardWake();
          // Stream.async is the honest empty-chunk source: fromChunks drops empties itself.
          // Empties are consumed inside the retained pull — neither end nor wake — and the
          // genuine end still surfaces after the frame.
          const pull = yield* createCaptureFramePull(
            Stream.async<RawFrame>((emit) => {
              emit.chunk(Chunk.empty());
              emit.single(makeFrame(3));
              emit.end();
            })
          );
          const out: string[] = [];
          for (let index = 0; index < 2; index += 1) {
            const next = yield* pull.pullNextAware!(wake);
            out.push(next._tag === "frame" ? next.frame.id : next._tag);
          }
          return out;
        })
      )
    );

    expect(tags).toEqual(["frame:3", "end"]);
  });

  it("overlapping direct and aware pulls consume each frame once", async () => {
    const ids = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const wake = yield* createWorkerBoardWake();
          const queue = yield* Queue.bounded<RawFrame>(4);
          yield* Queue.offer(queue, makeFrame(0));
          yield* Queue.offer(queue, makeFrame(1));
          const pull = yield* createCaptureFramePull(Stream.fromQueue(queue));
          // The one permit serializes both styles over the shared single-flight take:
          // concurrent callers split the frames with no duplicate and no extra subscriber.
          const [direct, aware] = yield* Effect.all(
            [
              pull.pullNext(),
              pull.pullNextAware!(wake).pipe(
                Effect.map((next) => (next._tag === "frame" ? next.frame : undefined))
              )
            ],
            { concurrency: 2 }
          );
          return [direct?.id, aware?.id].sort();
        })
      )
    );

    expect(ids).toEqual(["frame:0", "frame:1"]);
  });

  it("interrupting a blocked pull releases the permit for the next caller", async () => {
    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const wake = yield* createWorkerBoardWake();
          const queue = yield* Queue.bounded<RawFrame>(4);
          const pull = yield* createCaptureFramePull(Stream.fromQueue(queue));
          const blocked = yield* Effect.fork(pull.pullNextAware!(wake));
          yield* Effect.yieldNow();
          yield* Fiber.interrupt(blocked);
          yield* Queue.offer(queue, makeFrame(5));
          const next = yield* pull.pullNextAware!(wake);
          return next._tag === "frame" ? next.frame.id : next._tag;
        })
      )
    );

    expect(seen).toBe("frame:5");
  });

  it("propagates genuine upstream failures instead of ending", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const wake = yield* createWorkerBoardWake();
          const pull = yield* createCaptureFramePull(
            Stream.fail("boom" as never)
          );
          return yield* pull.pullNextAware!(wake);
        })
      )
    );

    expect(exit._tag).toBe("Failure");
  });

  it("subscribes once no matter how it is pulled", async () => {
    let subscriptions = 0;
    const counting = Stream.unwrap(
      Effect.as(
        Effect.sync(() => {
          subscriptions += 1;
        }),
        Stream.fromIterable([0, 1]).pipe(Stream.map((index) => makeFrame(index)))
      )
    );
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const wake = yield* createWorkerBoardWake();
          const pull = yield* createCaptureFramePull(counting);
          yield* pull.pullNext();
          yield* pull.pullNextAware!(wake);
          yield* pull.pullNext();
        })
      )
    );

    expect(subscriptions).toBe(1);
  });
});

// --- helpers ---

const makeFrame = (index: number): RawFrame => ({
  id: `frame:${index}`,
  sourceId: "test",
  time: nowTimePoint(index),
  cadence: {
    mode: "synthetic",
    sequence: index,
    droppedFrames: 0,
  },
  payload: {
    width: 1,
    height: 1,
    byteFormat: "rgba",
    encoding: "raw",
    data: new Uint8Array(4),
  },
});
