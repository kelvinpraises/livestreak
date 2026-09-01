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
});
