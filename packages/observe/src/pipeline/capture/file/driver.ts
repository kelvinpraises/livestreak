import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import { probeMedia, validateVideoDimensions, type FfmpegBinaries } from "#adapters/ffmpeg/index.js";
import type {
  CaptureDriver,
  CaptureDriverDescriptor,
  CaptureStageHealth,
  DescriptorValueSchema,
  FrameSource,
  RegistryFlagDescriptor
} from "#pipeline/capture/types.js";
import type { DescribeControlContext, ControlCellDefinition } from "#run/control/bus/types.js";
import { rawVideoFrameStream, type FileDecodeStats } from "./decode.js";

export interface FileCaptureConfig {
  readonly path: string;
}

export interface FileCaptureDriverOptions {
  readonly binaries?: FfmpegBinaries;
}

const sourceId = "capture:file";

interface NodeFsPromises {
  readonly access: (path: string) => Promise<unknown>;
}

const importNode = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);

const fsPromises = async (): Promise<NodeFsPromises> =>
  importNode("node:fs/promises") as Promise<NodeFsPromises>;

const stringValue = (description: string, required = false): DescriptorValueSchema => ({
  type: "string",
  description,
  required
});

const flag = (
  name: string,
  value: DescriptorValueSchema,
  help: string,
  extras: Omit<RegistryFlagDescriptor, "name" | "value" | "help"> = {}
): RegistryFlagDescriptor => ({
  name,
  value,
  help,
  ...extras
});

const configError = (message: string, details?: string): LiveStreakConfigError =>
  new LiveStreakConfigError({
    message,
    metadata: details === undefined ? undefined : { details }
  });

export const fileCaptureDescriptor: CaptureDriverDescriptor = {
  kind: "capture",
  id: "file",
  version: "0.1.0",
  displayName: "File Capture",
  summary: "Replay video frames from a local media file.",
  capabilityScopes: ["capture:file:*"],
  flags: [
    flag("path", stringValue("Path to the media file to replay.", true), "Read frames from a local file.")
  ],
  commands: [],
  sourceType: "file",
  sourceMode: "file"
};

export const validateFileCaptureConfig = (
  config: FileCaptureConfig
): Effect.Effect<FileCaptureConfig, LiveStreakError> =>
  Effect.gen(function* () {
    if (typeof config.path !== "string") {
      return yield* Effect.fail(configError("File capture path is required"));
    }
    if (config.path.trim().length === 0) {
      return yield* Effect.fail(configError("File capture path is required"));
    }

    yield* Effect.tryPromise({
      try: async () => {
        const fs = await fsPromises();
        await fs.access(config.path);
      },
      catch: (cause) =>
        configError(
          "File capture path is not readable",
          cause instanceof Error ? cause.message : String(cause)
        )
    });

    return {
      path: config.path
    };
  });

export const createFileCaptureDriver = (
  options: FileCaptureDriverOptions = {}
): CaptureDriver<FileCaptureConfig> => ({
  descriptor: fileCaptureDescriptor,
  validate: validateFileCaptureConfig,
  describeControl: (config, context) =>
    Effect.succeed(describeFileCaptureCell(config, context)),
  create: (config) =>
    Effect.gen(function* () {
      const probe = yield* probeMedia(config.path, options.binaries);
      yield* validateVideoDimensions(probe.width, probe.height);

      const stats: FileDecodeStats = {
        frameCount: 0,
        droppedFrames: 0,
        lastCadence: undefined,
        startedAtMs: undefined,
        status: "idle",
        message: undefined
      };

      const healthMessage = `file capture reading ${config.path}`;
      const health: Effect.Effect<CaptureStageHealth, LiveStreakError> = Effect.sync(() => ({
        stage: "capture",
        descriptorId: fileCaptureDescriptor.id,
        status: captureHealthStatus(stats.status),
        message: stats.message ?? healthMessage,
        updatedAtMs: Date.now(),
        sourceId,
        frameCount: stats.frameCount,
        droppedFrames: stats.droppedFrames,
        cadence: stats.lastCadence
      }));

      const frameSource: FrameSource = {
        descriptor: fileCaptureDescriptor,
        frames: rawVideoFrameStream({
          config,
          probe,
          sourceId,
          binaries: options.binaries,
          stats
        }),
        health
      };

      return frameSource;
    })
});

// --- helpers ---

const describeFileCaptureCell = (
  config: FileCaptureConfig,
  context: DescribeControlContext
): ControlCellDefinition => {
  const nowMs = context.nowMs ?? Date.now();

  return {
    id: "capture:file",
    cell: {
      label: "File Capture",
      catalog: "capture:file",
      // eslint-disable-next-line unicorn/no-null -- BoardCell.status tuple uses null for absent message
      status: ["idle", null, nowMs],
      settings: {
        path: config.path,
        maxPumpMs: 4
      },
      readonly: {
        sourceType: "file",
        sourceMode: "file"
      },
      functions: []
    }
  };
};

const captureHealthStatus = (
  status: FileDecodeStats["status"]
): CaptureStageHealth["status"] => {
  if (status === "idle") {
    return "starting";
  }
  if (status === "running") {
    return "running";
  }
  if (status === "failed") {
    return "failed";
  }
  return "stopped";
};
