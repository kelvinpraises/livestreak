import { describe, expect, it } from "vitest";
import { Chunk, Effect, Stream } from "effect";
import { createBrowserCaptureFrameSource } from "#pipeline/capture/browser/source.js";
import { countLateCadenceDrops } from "#pipeline/capture/browser/timing.js";
import { makeFakeBrowserCaptureAdapter } from "#test/helpers/browser-adapter.js";
import { createManualBrowserCaptureClock } from "#test/helpers/browser-capture-clock.js";

const frameBytes = new Uint8Array([255, 216, 255, 217]);

const collectTwoFrames = (clock: ReturnType<typeof createManualBrowserCaptureClock>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const adapter = makeFakeBrowserCaptureAdapter({
        frameBytes,
        latencyMs: 0
      });
      const source = yield* createBrowserCaptureFrameSource(
        {
          url: "https://example.com/cadence",
          captureFps: 30,
          maxFrames: 2
        },
        adapter,
        clock
      );
      const collected = yield* source.frames.pipe(Stream.take(2), Stream.runCollect);
      const health = yield* source.health;

      return {
        frames: Chunk.toReadonlyArray(collected),
        health
      };
    })
  );

describe("browser capture cadence timing", () => {
  it("does not count startup drift before the first frame", () => {
    const timing = { nextDueMs: 10 };

    expect(countLateCadenceDrops(timing, 250, 10, true)).toBe(0);
    expect(timing.nextDueMs).toBe(10);
  });

  it("counts overdue cadence periods after startup", () => {
    const timing = { nextDueMs: 10 };

    expect(countLateCadenceDrops(timing, 250, 10, false)).toBe(24);
    expect(timing.nextDueMs).toBe(250);
  });
});

describe("browser capture cadence", () => {
  it("does not count startup drift as a dropped first frame and starts media time at zero", async () => {
    const result = await Effect.runPromise(collectTwoFrames(createManualBrowserCaptureClock(0)));

    expect(result.frames[0]?.cadence.droppedFrames).toBe(0);
    expect(result.frames[0]?.cadence.sequence).toBe(0);
    expect(result.frames[0]?.time.mediaTimeMs).toBe(0);
    expect(result.frames[0]?.time.sourceTimeMs).toBe(0);
    expect(result.frames[1]?.time.mediaTimeMs).toBeGreaterThan(0);
    expect(result.frames[1]?.time.sourceTimeMs).toBe(result.frames[1]?.time.mediaTimeMs);
    expect(result.health.droppedFrames).toBe(0);
  });

  it("uses the injected clock for browser source health updatedAtMs", async () => {
    const clock = createManualBrowserCaptureClock(42_000);
    const result = await Effect.runPromise(collectTwoFrames(clock));

    expect(result.health.updatedAtMs).toBe(clock.nowMs());
    expect(result.health.updatedAtMs).toBeGreaterThanOrEqual(42_000);
  });
});
