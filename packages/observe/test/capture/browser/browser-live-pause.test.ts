import { Effect, Fiber, Ref, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { createBrowserCaptureDriver } from "#pipeline/capture/browser/index.js";
import { makeFakeBrowserCaptureAdapter } from "#test/helpers/browser-adapter.js";

describe("browser live pause", () => {
  it("stops fake adapter screenshots while paused and resumes after live.resume", async () => {
    let screenshotCount = 0;
    const adapter = makeFakeBrowserCaptureAdapter({
      frameBytes: new Uint8Array([255, 216, 255, 217]),
      onScreenshot: () => {
        screenshotCount += 1;
      }
    });
    const driver = createBrowserCaptureDriver(adapter);

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const config = yield* driver.validate({
            url: "https://example.com/live",
            captureFps: 60,
            viewport: { width: 64, height: 48 },
            maxFrames: 100
          });
          const source = yield* driver.create(config);
          if (source.live === undefined) {
            throw new Error("Expected browser FrameSource to expose live controls");
          }

          const frameCountReference = yield* Ref.make(0);
          const fiber = yield* Effect.fork(
            source.frames.pipe(
              Stream.runForEach(() =>
                Ref.update(frameCountReference, (count) => count + 1).pipe(Effect.asVoid)
              )
            )
          );

          yield* waitUntil(() => screenshotCount >= 2, 2000);
          const countBeforePause = screenshotCount;

          yield* source.live.pause();
          const pausedSnapshot = yield* source.live.snapshot;
          expect(pausedSnapshot.paused).toBe(true);

          yield* Effect.sleep("200 millis");
          const countAfterPauseSettles = screenshotCount;
          yield* Effect.sleep("200 millis");
          expect(screenshotCount).toBe(countAfterPauseSettles);
          expect(countAfterPauseSettles).toBeGreaterThanOrEqual(countBeforePause);

          yield* source.live.resume();
          yield* waitUntil(() => screenshotCount > countAfterPauseSettles, 2000);

          yield* Fiber.interrupt(fiber);
          const frames = yield* Ref.get(frameCountReference);
          expect(frames).toBeGreaterThanOrEqual(2);
        })
      )
    );
  });
});

// --- helpers ---

const waitUntil = (predicate: () => boolean, timeoutMs: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;

    while (!predicate()) {
      if (Date.now() >= deadline) {
        return yield* Effect.die(new Error("Timed out waiting for condition"));
      }

      yield* Effect.sleep("10 millis");
    }
  });
