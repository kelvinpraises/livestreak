import { Effect, Stream } from "effect";
import { LiveStreakConfigError } from "@livestreak/core";
import { nowTimePoint } from "@livestreak/schema";
import type {
  CaptureDriver,
  CaptureDriverDescriptor,
  CaptureStageHealth,
  CaptureVideoPayload,
  FrameSource,
  RawFrame
} from "#pipeline/capture/types.js";
import type { DescribeControlContext, ControlCellDefinition } from "#run/control/bus/types.js";

export interface SyntheticCaptureConfig {
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
}

export const syntheticCaptureDescriptor: CaptureDriverDescriptor = {
  kind: "capture",
  id: "synthetic",
  version: "0.1.0",
  displayName: "Synthetic Capture",
  summary: "Deterministic test frames for worker and pump development.",
  capabilityScopes: ["capture:synthetic:*"],
  flags: [],
  commands: [],
  sourceType: "synthetic",
  sourceMode: "file"
};

const defaultConfig: SyntheticCaptureConfig = {
  frameCount: 8,
  width: 16,
  height: 16,
  fps: 30
};

export const validateSyntheticCaptureConfig = (
  config: SyntheticCaptureConfig
): Effect.Effect<SyntheticCaptureConfig, LiveStreakConfigError> => {
  if (config.frameCount < 1) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "Synthetic capture frameCount must be at least 1"
      })
    );
  }

  if (config.width < 1) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "Synthetic capture width must be at least 1"
      })
    );
  }

  if (config.height < 1) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "Synthetic capture height must be at least 1"
      })
    );
  }

  if (config.fps < 1) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "Synthetic capture fps must be at least 1"
      })
    );
  }

  return Effect.succeed(config);
};

export const createSyntheticCaptureDriver = (): CaptureDriver<SyntheticCaptureConfig> => ({
  descriptor: syntheticCaptureDescriptor,
  validate: validateSyntheticCaptureConfig,
  describeControl: (config, context) =>
    Effect.succeed(describeSyntheticCaptureCell(config, context)),
  create: (config) =>
    Effect.sync(() => {
      const stats = {
        frameCount: 0,
        droppedFrames: 0
      };

      const sourceId = "capture:synthetic";
      const frames = Stream.range(0, config.frameCount - 1).pipe(
        Stream.map((index) => makeSyntheticFrame(sourceId, config, index))
      );

      const health: Effect.Effect<CaptureStageHealth, never> = Effect.sync(() => ({
        stage: "capture",
        descriptorId: syntheticCaptureDescriptor.id,
        status: "running",
        updatedAtMs: Date.now(),
        sourceId,
        frameCount: stats.frameCount,
        droppedFrames: stats.droppedFrames,
        cadence: {
          mode: "synthetic",
          expectedFps: config.fps,
          observedFps: config.fps,
          sequence: stats.frameCount,
          droppedFrames: 0
        }
      }));

      const frameSource: FrameSource = {
        descriptor: syntheticCaptureDescriptor,
        frames: frames.pipe(
          Stream.tap(() =>
            Effect.sync(() => {
              stats.frameCount += 1;
            })
          )
        ),
        health
      };

      return frameSource;
    })
});

// --- helpers ---

const describeSyntheticCaptureCell = (
  _config: SyntheticCaptureConfig,
  context: DescribeControlContext
): ControlCellDefinition => {
  const nowMs = context.nowMs ?? Date.now();

  return {
    id: "capture:synthetic",
    cell: {
      label: "Synthetic Capture",
      catalog: "capture:synthetic",
       
      status: ["idle", null, nowMs],
      settings: {},
      readonly: {
        sourceType: "synthetic",
        sourceMode: "file"
      },
      functions: []
    }
  };
};

const makeSyntheticFrame = (
  sourceId: string,
  config: SyntheticCaptureConfig,
  frameIndex: number
): RawFrame => {
  const payload = makeSyntheticVideoPayload(config, frameIndex);

  return {
    id: `${sourceId}:${frameIndex}`,
    sourceId,
    time: nowTimePoint(frameIndex),
    cadence: {
      mode: "synthetic",
      expectedFps: config.fps,
      observedFps: config.fps,
      sequence: frameIndex,
      droppedFrames: 0
    },
    payload
  };
};

const makeSyntheticVideoPayload = (
  config: SyntheticCaptureConfig,
  frameIndex: number
): CaptureVideoPayload => {
  const data = new Uint8Array(config.width * config.height * 4);
  const fill = frameIndex % 256;

  for (let index = 0; index < data.length; index += 4) {
    data[index] = fill;
    data[index + 1] = fill;
    data[index + 2] = fill;
    data[index + 3] = 255;
  }

  return {
    width: config.width,
    height: config.height,
    byteFormat: "rgba",
    encoding: "raw",
    data
  };
};

export const defaultSyntheticCaptureConfig = defaultConfig;
