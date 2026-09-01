import { Effect, Option, Stream } from "effect";
import type {
  CaptureDriver,
  CaptureDriverDescriptor,
  CaptureStageHealth,
  FrameSource,
  RawFrame
} from "#pipeline/capture/index.js";
import type { RuntimeKernelOptions } from "#run/runtime.js";
import { createSyntheticKernelOptions } from "#test/helpers/runtime.js";
import type { ObserveRunConfig } from "#run/config/types.js";

export interface BlockedCaptureCounters {
  createCalls: number;
  pullStarted: number;
  finalizerCalls: number;
  framesProduced: number;
  finalized: boolean;
}

export interface BlockedCaptureKernelOptionsResult {
  readonly options: RuntimeKernelOptions;
  readonly counters: BlockedCaptureCounters;
}

const blockedCaptureDescriptor: CaptureDriverDescriptor = {
  kind: "capture",
  id: "blocked",
  version: "0.1.0",
  displayName: "Blocked Capture",
  summary: "Capture driver that blocks on pull until interrupted.",
  capabilityScopes: ["capture:blocked:*"],
  flags: [],
  commands: [],
  sourceType: "synthetic",
  sourceMode: "file"
};

export const createBlockedCaptureDriver = (): {
  readonly driver: CaptureDriver<{ readonly frameCount: number }>;
  readonly counters: BlockedCaptureCounters;
} => {
  const counters: BlockedCaptureCounters = {
    createCalls: 0,
    pullStarted: 0,
    finalizerCalls: 0,
    framesProduced: 0,
    finalized: false
  };

  const driver: CaptureDriver<{ readonly frameCount: number }> = {
    descriptor: blockedCaptureDescriptor,
    validate: (config) => Effect.succeed(config),
    describeControl: (_config, context) =>
      Effect.succeed({
        id: "capture:blocked",
        cell: {
          label: "Blocked Capture",
          catalog: "capture:blocked",
          // eslint-disable-next-line unicorn/no-null -- BoardCell.status tuple uses null for absent message
          status: ["idle", null, context.nowMs ?? Date.now()],
          settings: {},
          readonly: {
            sourceType: "synthetic",
            sourceMode: "file"
          },
          functions: []
        }
      }),
    create: () =>
      Effect.scoped(
        Effect.gen(function* () {
          counters.createCalls += 1;

          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              counters.finalizerCalls += 1;
              counters.finalized = true;
            })
          );

          const sourceId = "capture:blocked";
          const frames = Stream.unfoldEffect(0, () =>
            Effect.gen(function* () {
              counters.pullStarted += 1;
              yield* Effect.never;
              return Option.none<readonly [RawFrame, number]>();
            })
          );

          const health: Effect.Effect<CaptureStageHealth, never> = Effect.succeed({
            stage: "capture",
            descriptorId: blockedCaptureDescriptor.id,
            status: "running",
            updatedAtMs: Date.now(),
            sourceId,
            frameCount: counters.framesProduced,
            droppedFrames: 0
          });

          const frameSource: FrameSource = {
            descriptor: blockedCaptureDescriptor,
            frames: frames.pipe(
              Stream.tap(() =>
                Effect.sync(() => {
                  counters.framesProduced += 1;
                })
              )
            ),
            health
          };

          return frameSource;
        })
      )
  };

  return { driver, counters };
};

export const createBlockedCaptureKernelOptions = (): BlockedCaptureKernelOptionsResult => {
  const { driver, counters } = createBlockedCaptureDriver();
  const base = createSyntheticKernelOptions(512);

  return {
    options: {
      ...base.options,
      captureDriver: driver,
      maxTurns: 512 * 64
    },
    counters
  };
};

export const makeBlockedObserveRun = (runId: string, outputPath: string): ObserveRunConfig => ({
  runId,
  capture: {
    driverId: "blocked",
    config: { frameCount: 512 }
  },
  sink: {
    driverId: "memory",
    config: { path: outputPath }
  },
  // eslint-disable-next-line unicorn/no-null -- passthrough signal
  process: null
});
