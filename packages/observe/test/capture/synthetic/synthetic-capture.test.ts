import { describe, expect, it } from "vitest";
import { Effect, Stream } from "effect";
import {
  createSyntheticCaptureDriver,
  defaultSyntheticCaptureConfig
} from "#pipeline/capture/synthetic/driver.js";

describe("synthetic capture driver", () => {
  it("emits the configured number of raw frames", async () => {
    const driver = createSyntheticCaptureDriver();
    const config = await Effect.runPromise(driver.validate(defaultSyntheticCaptureConfig));
    const source = await Effect.runPromise(Effect.scoped(driver.create(config)));
    const frames = await Effect.runPromise(
      source.frames.pipe(
        Stream.runCollect,
        Effect.map((chunk) => [...chunk])
      )
    );

    expect(frames).toHaveLength(defaultSyntheticCaptureConfig.frameCount);
    expect(frames[0]?.payload.width).toBe(defaultSyntheticCaptureConfig.width);
    expect(frames[0]?.payload.data.byteLength).toBe(
      defaultSyntheticCaptureConfig.width * defaultSyntheticCaptureConfig.height * 4
    );
  });

  it("continuous mode emits an unbounded advancing sequence", async () => {
    const driver = createSyntheticCaptureDriver();
    const config = await Effect.runPromise(
      driver.validate({ ...defaultSyntheticCaptureConfig, continuous: true })
    );
    const source = await Effect.runPromise(Effect.scoped(driver.create(config)));
    const frames = await Effect.runPromise(
      source.frames.pipe(
        Stream.take(4),
        Stream.runCollect,
        Effect.map((chunk) => [...chunk])
      )
    );

    expect(frames).toHaveLength(4);
    // Advancing sequence: ids order and the frame shade moves with the index.
    expect(frames.map((frame) => frame.id)).toEqual([
      "capture:synthetic:0",
      "capture:synthetic:1",
      "capture:synthetic:2",
      "capture:synthetic:3"
    ]);
    expect(frames[0]?.payload.data[0]).toBe(0);
    expect(frames[3]?.payload.data[0]).toBe(3);
    expect(frames[3]?.cadence.sequence).toBe(3);
  });
});
