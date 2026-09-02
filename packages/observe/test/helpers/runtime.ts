import { Effect, Stream } from "effect";
import {
  createSyntheticCaptureDriver,
  defaultSyntheticCaptureConfig,
  type SyntheticCaptureConfig
} from "#pipeline/capture/synthetic/driver.js";
import type {
  SinkAttachment,
  SinkDriver,
  SinkFinalizeResult,
  SinkStageHealth
} from "#pipeline/publish/index.js";
import type { CaptureDriver } from "#pipeline/capture/index.js";
import type { RuntimeKernelOptions } from "#run/runtime.js";
import { makeObserveRunSync } from "#test/helpers/observe-run.js";
import { syntheticCaptureRunConfig } from "#test/helpers/run-config.js";

export interface SyntheticKernelOptionsResult {
  readonly options: RuntimeKernelOptions;
  readonly delivered: number[];
}

export interface CountedSyntheticKernelOptionsResult extends SyntheticKernelOptionsResult {
  readonly attachCount: () => number;
  readonly createCount: () => number;
}

const memorySinkDriver = (
  delivered: number[]
): SinkDriver<{ readonly path: string }> => ({
  descriptor: {
    kind: "publish",
    id: "memory",
    version: "0.1.0",
    displayName: "Memory Sink",
    summary: "In-memory sink for runtime tests.",
    capabilityScopes: [],
    flags: [],
    commands: [],
    mode: "file",
    requiresHost: false,
    debugOnly: true
  },
  mode: "file",
  validate: (sinkConfig) => Effect.succeed(sinkConfig),
  describeControl: (config, context) => {
    const nowMs = context.nowMs ?? Date.now();
    const instanceId = context.instanceId ?? "memory-sink";

    return Effect.succeed({
      id: `sink:${instanceId}`,
      cell: {
        label: "Memory Sink",
        catalog: "sink:memory",
         
        status: ["idle", null, nowMs],
        settings: {
          path: config.path,
          subscribe: ["publish.video.rendered"],
          required: true
        },
        readonly: {},
        functions: []
      }
    });
  },
  attach: () =>
    Effect.succeed({
      id: "memory-sink",
      deliver: (item) =>
        Effect.sync(() => {
          if (item.kind === "video") {
            delivered.push(item.sequence);
          }
        }),
      finalize: Effect.succeed({
        deliveredItems: delivered.length,
        output: { kind: "memory" }
      } satisfies SinkFinalizeResult),
      health: Effect.succeed({
        stage: "publish",
        descriptorId: "memory",
        status: "running",
        updatedAtMs: Date.now(),
        deliveredItems: delivered.length
      } satisfies SinkStageHealth),
      detach: Effect.void
    } satisfies SinkAttachment)
});

export const createSyntheticKernelOptions = (
  frameCount = 4
): SyntheticKernelOptionsResult => {
  const synthetic = createSyntheticCaptureDriver();
  const config: SyntheticCaptureConfig = {
    ...defaultSyntheticCaptureConfig,
    frameCount
  };
  const delivered: number[] = [];

  const captureDriver: CaptureDriver<SyntheticCaptureConfig> = {
    ...synthetic,
    validate: () => synthetic.validate(config)
  };

  return {
    options: {
      captureDriver,
      sinkDriver: memorySinkDriver(delivered),
      maxTurns: frameCount * 64
    },
    delivered
  };
};

export const createCountedSyntheticKernelOptions = (
  frameCount = 64
): CountedSyntheticKernelOptionsResult => {
  let attachCount = 0;
  let createCount = 0;
  const base = createSyntheticKernelOptions(frameCount);
  const synthetic = createSyntheticCaptureDriver();
  const config: SyntheticCaptureConfig = {
    ...defaultSyntheticCaptureConfig,
    frameCount
  };

  const captureDriver: CaptureDriver<SyntheticCaptureConfig> = {
    ...synthetic,
    validate: () => synthetic.validate(config),
    create: (createConfig) => {
      createCount += 1;
      return synthetic.create(createConfig);
    }
  };

  const sinkDriver: SinkDriver<{ readonly path: string }> = {
    ...base.options.sinkDriver!,
    attach: (sinkConfig) => {
      attachCount += 1;
      return base.options.sinkDriver!.attach(sinkConfig);
    }
  };

  return {
    options: {
      ...base.options,
      captureDriver,
      sinkDriver
    },
    delivered: base.delivered,
    attachCount: () => attachCount,
    createCount: () => createCount
  };
};

export const createYieldingSyntheticKernelOptions = (
  frameCount = 512
): SyntheticKernelOptionsResult => {
  const base = createSyntheticKernelOptions(frameCount);
  const synthetic = createSyntheticCaptureDriver();
  const config: SyntheticCaptureConfig = {
    ...defaultSyntheticCaptureConfig,
    frameCount
  };

  const captureDriver: CaptureDriver<SyntheticCaptureConfig> = {
    ...synthetic,
    validate: () => synthetic.validate(config),
    create: (createConfig) =>
      Effect.gen(function* () {
        const source = yield* synthetic.create(createConfig);
        return {
          ...source,
          frames: source.frames.pipe(
            Stream.mapEffect((frame) =>
              Effect.gen(function* () {
                yield* Effect.yieldNow();
                return frame;
              })
            )
          )
        };
      })
  };

  return {
    options: {
      ...base.options,
      captureDriver
    },
    delivered: base.delivered
  };
};

export const makeSyntheticObserveRun = (runId: string, outputPath: string) =>
  makeObserveRunSync(
    syntheticCaptureRunConfig(runId, outputPath, {
      frameCount: 8,
      width: 16,
      height: 16,
      fps: 30
    })
  );
