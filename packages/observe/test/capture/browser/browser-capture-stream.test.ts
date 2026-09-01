import { describe, expect, it } from "vitest";
import { Chunk, Effect, Stream } from "effect";
import {
  browserCaptureDescriptor,
  createBrowserCaptureDriver,
} from "#pipeline/capture/browser/index.js";
import { makeFakeBrowserCaptureAdapter } from "#test/helpers/browser-adapter.js";

describe("browser capture stream", () => {
  it("emits sequential RawFrame items with browser metadata, cadence, and health", async () => {
    const adapter = makeFakeBrowserCaptureAdapter({
      frameBytes: new Uint8Array([255, 216, 255, 217])
    });
    const driver = createBrowserCaptureDriver(adapter);

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const config = yield* driver.validate({
            url: "https://example.com/live",
            captureFps: 30,
            viewport: { width: 64, height: 48 },
            maxFrames: 3
          });
          const source = yield* driver.create(config);
          const frames = yield* source.frames.pipe(Stream.runCollect);
          const health = yield* source.health;

          return {
            source,
            frames: Chunk.toReadonlyArray(frames),
            health
          };
        })
      )
    );

    expect(result.source.descriptor).toEqual(browserCaptureDescriptor);
    expect(result.frames).toHaveLength(3);
    expect(result.frames.map((frame) => frame.cadence.sequence)).toEqual([0, 1, 2]);
    expect(result.frames.every((frame) => frame.sourceId === "capture:browser")).toBe(true);
    expect(result.frames.every((frame) => frame.payload.byteFormat === "jpeg")).toBe(true);
    expect(result.frames.every((frame) => frame.payload.encoding === "jpeg")).toBe(true);
    expect(result.frames.every((frame) => frame.payload.expectedFps === 30)).toBe(true);
    expect(result.frames.every((frame) => frame.payload.width === 64)).toBe(true);
    expect(result.frames.every((frame) => frame.cadence.mode === "capture")).toBe(true);
    expect(result.health.stage).toBe("capture");
    expect(result.health.descriptorId).toBe("browser");
    expect(result.health.sourceId).toBe("capture:browser");
    expect(result.health.frameCount).toBe(3);
    expect(result.health.cadence?.expectedFps).toBe(30);
  });

  it("copies screenshot bytes into the frame payload", async () => {
    const frameBytes = new Uint8Array([10, 20, 30, 40]);
    const adapter = makeFakeBrowserCaptureAdapter({ frameBytes, encoding: "png" });
    const driver = createBrowserCaptureDriver(adapter);

    const frame = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const config = yield* driver.validate({
            url: "https://example.com/copy",
            captureFps: 10,
            encoding: "png",
            maxFrames: 1
          });
          const source = yield* driver.create(config);
          const frames = yield* source.frames.pipe(Stream.take(1), Stream.runCollect);

          return Chunk.toReadonlyArray(frames)[0];
        })
      )
    );

    expect(frame?.payload.data).toEqual(frameBytes);
    expect(frame?.payload.data).not.toBe(frameBytes);
    expect(frame?.payload.byteFormat).toBe("png");
  });

  it("closes the page when the scoped run exits", async () => {
    let closed = false;
    const adapter = makeFakeBrowserCaptureAdapter({
      frameBytes: new Uint8Array([1, 2, 3]),
      onClose: () => {
        closed = true;
      }
    });
    const driver = createBrowserCaptureDriver(adapter);

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const config = yield* driver.validate({
            url: "https://example.com/finalizer",
            captureFps: 30,
            maxFrames: 1
          });
          yield* driver.create(config);
        })
      )
    );

    expect(closed).toBe(true);
  });
});
