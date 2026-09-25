import { describe, expect, it } from "vitest";
import { Effect, Fiber, Stream } from "effect";
import { createIngestCaptureDriver } from "#pipeline/capture/ingest/driver.js";

const PORT = 48719;
const W = 16;
const H = 16;
const frame = (fill: number): Uint8Array<ArrayBuffer> => {
  const data = new Uint8Array(W * H * 4);
  data.fill(fill);
  data.forEach((_v, i) => {
    if (i % 4 === 3) data[i] = 255;
  });
  return data;
};

const post = (port: number, body: Uint8Array<ArrayBuffer>) =>
  fetch(`http://127.0.0.1:${port}/frames`, { method: "POST", body });

describe("ingest capture driver", () => {
  it("rejects configs without a bot frame contract", async () => {
    const driver = createIngestCaptureDriver();
    const exit = await Effect.runPromiseExit(
      // @ts-expect-error — the bot contract requires dimensions; the board must carry them
      driver.validate({ port: PORT })
    );

    expect(exit._tag).toBe("Failure");
  });

  it("serves a bot's arbitrary rendered frames as advancing RawFrames", async () => {
    const driver = createIngestCaptureDriver();
    const frames = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const source = yield* driver.create({
            port: PORT,
            width: W,
            height: H,
            fps: 30
          });
          const fiber = yield* Effect.fork(
            source.frames.pipe(
              Stream.take(3),
              Stream.runCollect,
              Effect.map((chunk) => [...chunk])
            )
          );
          for (const fill of [11, 22, 33]) {
            const res = yield* Effect.promise(() => post(PORT, frame(fill)));
            expect(res.status).toBe(200);
          }
          return yield* Fiber.join(fiber);
        })
      )
    );

    expect(frames.map((f) => f.id)).toEqual([
      "capture:ingest:0",
      "capture:ingest:1",
      "capture:ingest:2"
    ]);
    expect(frames[0]?.payload.data[0]).toBe(11);
    expect(frames[2]?.payload.data[0]).toBe(33);
    expect(frames[2]?.payload.byteFormat).toBe("rgba");
  });

  it("rejects wrong-sized bodies instead of emitting corrupt frames", async () => {
    const driver = createIngestCaptureDriver();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* driver.create({ port: PORT + 1, width: W, height: H, fps: 30 });
          const res = yield* Effect.promise(() => post(PORT + 1, new Uint8Array(10)));
          expect(res.status).toBe(400);
        })
      )
    );
  });

  it("a full queue answers 429 through the real endpoint instead of hanging the POST", async () => {
    const driver = createIngestCaptureDriver();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // maxQueuedFrames: 1 and NO consumer yet: the first POST buffers, the second must
          // be rejected synchronously — Queue.offer would park it until a take frees space.
          const source = yield* driver.create({
            port: PORT + 2,
            width: W,
            height: H,
            fps: 30,
            maxQueuedFrames: 1
          });
          const first = yield* Effect.promise(() => post(PORT + 2, frame(77)));
          expect(first.status).toBe(200);
          const second = yield* Effect.promise(() => post(PORT + 2, frame(88)));
          expect(second.status).toBe(429);
          expect(yield* Effect.promise(() => second.json())).toMatchObject({
            error: expect.stringContaining("slow down")
          });
          // The buffered frame is intact and consumable afterwards.
          const taken = yield* source.frames.pipe(Stream.take(1), Stream.runCollect);
          expect([...taken][0]?.payload.data[0]).toBe(77);
          const health = yield* source.health;
          expect(health.droppedFrames).toBe(1);
        })
      )
    );
  });
});
