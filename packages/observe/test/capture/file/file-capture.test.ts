import { Chunk, Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
  createFileCaptureDriver,
  validateFileCaptureConfig
} from "#pipeline/capture/file/driver.js";
import { makeFfmpegRawVideoDecodeArguments } from "#pipeline/capture/file/decode.js";
import { parseFraction } from "#adapters/ffmpeg/index.js";
import type { CaptureStageHealth } from "#pipeline/capture/index.js";
import type { RawFrame } from "#pipeline/capture/index.js";
import { makeTinyMp4Fixture, removeFixtureDirectory, skipUnlessFfmpegIntegration } from "#test/helpers/ffmpeg.js";

describe("file capture driver", () => {
  it("builds replay-only rawvideo decode arguments", () => {
    expect(makeFfmpegRawVideoDecodeArguments("input.mp4")).toEqual([
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "input.mp4",
      "-an",
      "-sn",
      "-dn",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1"
    ]);
  });

  it("parses ffprobe frame-rate metadata", async () => {
    expect(parseFraction("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseFraction("0/0")).toBeUndefined();
  });

  it("decodes a tiny generated fixture with rgb payloads and health", async (context) => {
    await skipUnlessFfmpegIntegration(context);

    const fixture = await makeTinyMp4Fixture();

    try {
      const result = await decodeFixtureSample(fixture.path);
      assertDecodedFixture(result);
    } finally {
      await removeFixtureDirectory(fixture.directory);
    }
  });

  it("rejects unreadable capture paths", async () => {
    const exit = await Effect.runPromise(
      validateFileCaptureConfig({
        path: "/tmp/flowstream-missing-input.mp4"
      }).pipe(Effect.exit)
    );

    expect(exit._tag).toBe("Failure");
  });
});

const decodeFixtureSample = async (fixturePath: string) => {
  const driver = createFileCaptureDriver();
  const config = await Effect.runPromise(
    driver.validate({
      path: fixturePath
    })
  );

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const source = yield* driver.create(config);
        const frames = yield* source.frames.pipe(Stream.take(3), Stream.runCollect);
        const health = yield* source.health;

        return {
          frames: Chunk.toReadonlyArray(frames),
          health
        };
      })
    )
  );
};

const assertDecodedFixture = (result: {
  readonly frames: readonly RawFrame[];
  readonly health: CaptureStageHealth;
}) => {
  expect(result.frames).toHaveLength(3);
  expect(result.frames[0]?.payload.width).toBe(4);
  expect(result.frames[0]?.payload.height).toBe(4);
  expect(result.frames[0]?.payload.byteFormat).toBe("rgb");
  expect(result.frames[0]?.payload.expectedFps).toBeGreaterThan(0);
  expect(result.frames[0]?.payload.data.byteLength).toBe(4 * 4 * 3);
  expect(result.frames[0]?.time.mediaTimeMs).toBeDefined();
  expect(result.frames[1]?.time.mediaTimeMs).toBeGreaterThan(result.frames[0]?.time.mediaTimeMs ?? -1);
  expect(result.health.sourceId).toBe("capture:file");
  expect(result.health.frameCount).toBeGreaterThanOrEqual(3);
};
