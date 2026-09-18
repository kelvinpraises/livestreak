import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
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
import {
  createFmp4Encoder,
  type Fmp4Encoder,
  type Fmp4EncoderConfig
} from "#pipeline/publish/encoder/fmp4.js";
import type { FfmpegBinaries } from "#adapters/ffmpeg/index.js";
import { readI420Frame } from "#pipeline/publish/sinks/i420.js";
import { liveSinkCloseCommand, liveSinkConfigureCommand } from "./commands.js";
import type { Fmp4IngestTransport } from "./transport.js";

/** Factory for the fMP4 encoder; the real one spawns ffmpeg, tests inject a synthetic one. */
export type Fmp4EncoderFactory = (
  config: Fmp4EncoderConfig
) => Effect.Effect<Fmp4Encoder, LiveStreakError>;

/**
 * Live fMP4 publisher sink — encode ONCE, fan out bytes.
 *
 * Consumes the run's raw I420 (yuv420p) frames (same contract the WebRTC sink used), pipes them through a
 * single H.264 fragmented-MP4 encode, and ships the init segment + each GOP-aligned fragment over ONE
 * outbound connection to the host ingest endpoint. The host ring-buffers and fans the same bytes out to N
 * viewers (MSE playback), so the producer's cost is linear BANDWIDTH, not a per-viewer encode. Fragments
 * flow at fragment granularity as ffmpeg closes each moof/mdat — a continuous real-time flow, never
 * accumulate-then-send.
 */
export interface LiveSinkConfig {
  /** The single ingest transport to the host (host-mediated WS in production, a fake in tests). */
  readonly transport: Fmp4IngestTransport;
  /** Stream/market id this feed is scoped to (the id the viewer consumes under). */
  readonly streamId?: string;
  /** Target fragment duration in seconds (GOP length); defaults to {@link defaultFragmentSeconds}. */
  readonly fragmentSeconds?: number;
  readonly binaries?: FfmpegBinaries;
}

export interface LiveSinkDriverOptions {
  readonly fragmentSeconds?: number;
  readonly binaries?: FfmpegBinaries;
  /** Override the encoder factory (tests inject a synthetic encoder to exercise lifecycle without ffmpeg). */
  readonly encoderFactory?: Fmp4EncoderFactory;
}

const attachmentId = "live-fmp4";
// ~1s fragments keep live latency near a second while staying GOP-aligned (one keyframe per fragment).
const defaultFragmentSeconds = 1;

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
): RegistryFlagDescriptor => ({ name, value, help, ...extras });

const configError = (message: string, details?: string): LiveStreakConfigError =>
  new LiveStreakConfigError({ message, metadata: details === undefined ? undefined : { details } });

export const liveSinkDescriptor: SinkDriverDescriptor = {
  kind: "publish",
  id: "live",
  version: "0.1.0",
  displayName: "Live Stream Sink",
  summary: "Encode-once fragmented-MP4 stream fanned out to viewers via the host.",
  capabilityScopes: ["sink:live:*"],
  flags: [
    flag(
      "streamId",
      stringValue("Stream/market id this live feed is scoped to."),
      "Scope the live fMP4 feed to a stream id."
    )
  ],
  commands: [liveSinkConfigureCommand, liveSinkCloseCommand],
  mode: "local",
  requiresHost: true,
  debugOnly: false
};

export const validateLiveSinkConfig = (
  config: LiveSinkConfig
): Effect.Effect<LiveSinkConfig, LiveStreakError> =>
  Effect.gen(function* () {
    if (config.transport === null || typeof config.transport !== "object") {
      return yield* Effect.fail(configError("Live sink requires an ingest transport"));
    }
    if (
      typeof config.transport.sendInit !== "function" ||
      typeof config.transport.sendFragment !== "function" ||
      typeof config.transport.end !== "function" ||
      typeof config.transport.onError !== "function"
    ) {
      return yield* Effect.fail(
        configError("Live sink transport must provide sendInit / sendFragment / end / onError")
      );
    }
    if (
      config.fragmentSeconds !== undefined &&
      (!Number.isFinite(config.fragmentSeconds) || config.fragmentSeconds <= 0)
    ) {
      return yield* Effect.fail(configError("Live sink fragmentSeconds must be a positive number"));
    }
    return config;
  });

export const createLiveSinkDriver = (
  options: LiveSinkDriverOptions = {}
): SinkDriver<LiveSinkConfig> => ({
  descriptor: liveSinkDescriptor,
  mode: "local",
  validate: validateLiveSinkConfig,
  describeControl: (config, context) => Effect.succeed(describeLiveSinkCell(config, context)),
  attach: (config) =>
    Effect.gen(function* () {
      const fragmentSeconds =
        config.fragmentSeconds ?? options.fragmentSeconds ?? defaultFragmentSeconds;

      const stats = {
        deliveredItems: 0,
        status: "starting" as "starting" | "running" | "stopped" | "failed",
        message: "live sink encoding one fMP4 stream for host fan-out"
      };

      let encoder: Fmp4Encoder | undefined;
      let finalized = false;

      // Surface transport send/connect errors on the health path without interrupting the encode (the host
      // drops slow viewers; the producer keeps encoding live).
      config.transport.onError((error) => {
        stats.message = `live ingest send failed — ${error.message}`;
      });

      // Ship each completed init/fragment out the single ingest connection. The transport send is a
      // synchronous fire-and-forget (a WS send is synchronous), matching the encoder's stdout callback.
      const shipChunk = (chunk: { kind: "init" | "fragment"; data: Uint8Array }): void => {
        if (chunk.kind === "init") {
          config.transport.sendInit(chunk.data);
        } else {
          config.transport.sendFragment(chunk.data);
        }
      };

      const teardown = Effect.gen(function* () {
        if (finalized) return;
        finalized = true;
        if (encoder !== undefined) {
          yield* encoder.finalize.pipe(Effect.catchAll(() => Effect.void));
        }
        yield* config.transport.end("stream_ended").pipe(Effect.catchAll(() => Effect.void));
        if (stats.status !== "failed") stats.status = "stopped";
      });

      yield* Effect.addFinalizer(() => teardown.pipe(Effect.catchAll(() => Effect.void)));
      stats.status = "running";

      const deliver = (item: SinkDeliveryItem): Effect.Effect<void, LiveStreakError> =>
        Effect.gen(function* () {
          if (item.kind === "marker") {
            // eos flushes the encode + ends the feed cleanly; pause markers pass through (the encode keeps
            // running against whatever the capture presents while paused, per the timeline contract).
            if (item.marker.kind === "eos") {
              yield* teardown;
            }
            return;
          }
          const frame = yield* readI420Frame(item.payload, "Live");
          if (encoder === undefined) {
            const makeEncoder = options.encoderFactory ?? createFmp4Encoder;
            encoder = yield* makeEncoder({
              width: frame.width,
              height: frame.height,
              fps: frame.fps,
              fragmentSeconds,
              onChunk: shipChunk,
              binaries: options.binaries
            });
          }
          yield* encoder.writeFrame(frame.data);
          stats.deliveredItems += 1;
        });

      const finalize: Effect.Effect<SinkFinalizeResult, LiveStreakError> = Effect.gen(function* () {
        yield* teardown;
        return { deliveredItems: stats.deliveredItems, output: { kind: "memory" } };
      });

      const health: Effect.Effect<SinkStageHealth, LiveStreakError> = Effect.sync(() => ({
        stage: "publish",
        descriptorId: liveSinkDescriptor.id,
        status: stats.status,
        message: stats.message,
        updatedAtMs: Date.now(),
        attachmentId,
        deliveredItems: stats.deliveredItems
      }));

      const attachment: SinkAttachment = {
        id: attachmentId,
        deliver,
        finalize,
        health,
        detach: Effect.void
      };

      return attachment;
    })
});

// --- helpers ---

const describeLiveSinkCell = (
  config: LiveSinkConfig,
  context: DescribeControlContext
): ControlCellDefinition => {
  const nowMs = context.nowMs ?? Date.now();
  const instanceId = context.instanceId ?? config.streamId ?? "live-fmp4";
  return {
    id: `sink:${instanceId}`,
    cell: {
      label: "Live Stream",
      catalog: "sink:live",
      status: ["idle", null, nowMs],
      settings: {
        transport: "fmp4-fanout",
        subscribe: ["publish.video.rendered"]
      },
      readonly: config.streamId === undefined ? {} : { streamId: config.streamId },
      functions: []
    }
  };
};

