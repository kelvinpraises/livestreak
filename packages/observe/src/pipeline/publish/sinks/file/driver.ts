import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type { CaptureVideoPayload } from "#pipeline/capture/index.js";
import type { FfmpegBinaries } from "#adapters/ffmpeg/index.js";
import { createMp4VideoEncoder, type Mp4VideoEncoder, type Mp4EncoderInputFormat } from "#pipeline/publish/encoder/mp4.js";
import type {
  DescriptorValueSchema,
  RegistryFlagDescriptor,
  SinkAttachment,
  SinkDeliveryItem,
  SinkDriver,
  SinkDriverDescriptor,
  SinkFinalizeResult,
  SinkStageHealth
} from "#pipeline/publish/index.js";
import type { DescribeControlContext, ControlCellDefinition } from "#run/control/bus/types.js";

export interface FileSinkConfig {
  readonly path: string;
}

export interface FileSinkDriverOptions {
  readonly binaries?: FfmpegBinaries;
}

const attachmentId = "file-export";

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

export const fileSinkDescriptor: SinkDriverDescriptor = {
  kind: "publish",
  id: "file",
  version: "0.1.0",
  displayName: "File Sink",
  summary: "Export rendered video to an MP4 file.",
  capabilityScopes: ["sink:file:*"],
  flags: [
    flag("path", stringValue("Path for the exported MP4 file.", true), "Write MP4 output to a local file.")
  ],
  commands: [],
  mode: "file",
  requiresHost: false,
  debugOnly: false
};

export const validateFileSinkConfig = (
  config: FileSinkConfig
): Effect.Effect<FileSinkConfig, LiveStreakError> =>
  Effect.gen(function* () {
    if (typeof config.path !== "string") {
      return yield* Effect.fail(configError("File sink path is required"));
    }
    if (config.path.trim().length === 0) {
      return yield* Effect.fail(configError("File sink path is required"));
    }

    const exists = yield* pathExists(config.path);
    if (exists) {
      return yield* Effect.fail(
        configError("File sink output path already exists", config.path)
      );
    }

    return {
      path: config.path
    };
  });

export const createFileSinkDriver = (
  options: FileSinkDriverOptions = {}
): SinkDriver<FileSinkConfig> => ({
  descriptor: fileSinkDescriptor,
  mode: "file",
  validate: validateFileSinkConfig,
  describeControl: (config, context) =>
    Effect.succeed(describeFileSinkCell(config, context)),
  attach: (config) =>
    Effect.gen(function* () {
      const stats = {
        deliveredItems: 0,
        status: "running" as "running" | "stopped" | "failed",
        message: `file sink writing ${config.path}`
      };

      let encoder: Mp4VideoEncoder | undefined;
      let finalized = false;

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          if (finalized) {
            return;
          }
          if (encoder === undefined) {
            return;
          }
          yield* encoder.finalize;
        }).pipe(Effect.catchAll(() => Effect.void))
      );

      const deliver = (item: SinkDeliveryItem): Effect.Effect<void, LiveStreakError> =>
        Effect.gen(function* () {
          if (item.kind === "marker") {
            return;
          }

          const payload = yield* readVideoPayload(item.payload);

          if (encoder === undefined) {
            encoder = yield* createMp4VideoEncoder({
              outputPath: config.path,
              width: payload.width,
              height: payload.height,
              fps: payload.expectedFps,
              inputFormat: payload.inputFormat,
              binaries: options.binaries
            });
          }

          yield* encoder.writeFrame(payload.data);
          stats.deliveredItems += 1;
        });

      const finalize: Effect.Effect<SinkFinalizeResult, LiveStreakError> = Effect.gen(function* () {
        if (finalized) {
          return {
            deliveredItems: stats.deliveredItems,
            output: {
              kind: "file",
              uri: config.path
            }
          };
        }

        finalized = true;

        if (encoder !== undefined) {
          yield* encoder.finalize;
        }

        stats.status = "stopped";

        return {
          deliveredItems: stats.deliveredItems,
          output: {
            kind: "file",
            uri: config.path
          }
        };
      });

      const health: Effect.Effect<SinkStageHealth, LiveStreakError> = Effect.sync(() => ({
        stage: "publish",
        descriptorId: fileSinkDescriptor.id,
        status: stats.status,
        message: stats.message,
        updatedAtMs: Date.now(),
        attachmentId,
        deliveredItems: stats.deliveredItems
      }));

      const detach = Effect.void;

      const attachment: SinkAttachment = {
        id: attachmentId,
        deliver,
        finalize,
        health,
        detach
      };

      return attachment;
    })
});

// --- helpers ---

const describeFileSinkCell = (
  config: FileSinkConfig,
  context: DescribeControlContext
): ControlCellDefinition => {
  const nowMs = context.nowMs ?? Date.now();
  const instanceId = context.instanceId ?? "file-export";

  return {
    id: `sink:${instanceId}`,
    cell: {
      label: "File Export",
      catalog: "sink:file",
      // eslint-disable-next-line unicorn/no-null -- BoardCell.status tuple uses null for absent message
      status: ["idle", null, nowMs],
      settings: {
        path: config.path,
        subscribe: ["publish.video.rendered"],
        required: true
      },
      readonly: {},
      functions: []
    }
  };
};

const pathExists = (path: string): Effect.Effect<boolean, never> =>
  Effect.tryPromise({
    try: async () => {
      const fs = await fsPromises();
      await fs.access(path);
    },
    catch: () => new Error("missing")
  }).pipe(
    Effect.as(true),
    Effect.catchAll(() => Effect.succeed(false))
  );

const readVideoPayload = (
  payload: unknown
): Effect.Effect<
  CaptureVideoPayload & { readonly expectedFps: number; readonly inputFormat: Mp4EncoderInputFormat },
  LiveStreakError
> =>
  Effect.gen(function* () {
    if (payload === null) {
      return yield* Effect.fail(configError("File sink received an empty video payload"));
    }
    if (typeof payload !== "object") {
      return yield* Effect.fail(configError("File sink received an invalid video payload"));
    }

    const candidate = payload as CaptureVideoPayload;
    if (typeof candidate.width !== "number") {
      return yield* Effect.fail(configError("File sink received a video payload without width"));
    }
    if (typeof candidate.height !== "number") {
      return yield* Effect.fail(configError("File sink received a video payload without height"));
    }

    const inputFormat = yield* resolveMp4InputFormat(candidate.byteFormat);
    if (!(candidate.data instanceof Uint8Array)) {
      return yield* Effect.fail(configError("File sink received a video payload without frame bytes"));
    }
    if (candidate.expectedFps === undefined) {
      return yield* Effect.fail(
        configError("File sink cannot encode MP4 without expectedFps on the video payload")
      );
    }

    return {
      ...candidate,
      expectedFps: candidate.expectedFps,
      inputFormat
    };
  });

const resolveMp4InputFormat = (
  byteFormat: CaptureVideoPayload["byteFormat"]
): Effect.Effect<Mp4EncoderInputFormat, LiveStreakConfigError> => {
  if (byteFormat === "rgb") {
    return Effect.succeed("rgb");
  }
  if (byteFormat === "jpeg") {
    return Effect.succeed("jpeg");
  }
  if (byteFormat === "png") {
    return Effect.succeed("png");
  }

  return Effect.fail(
    configError(`File sink does not support ${byteFormat} video payloads for MP4 export`)
  );
};
