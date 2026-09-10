import { Effect } from "effect";
import {
  LiveStreakConfigError,
  LiveStreakRuntimeError,
  type LiveStreakError
} from "@livestreak/core";
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
  resolveDefaultPeerFactory,
  type RtcDataChannelLike,
  type RtcPeerConnectionFactory,
  type RtcPeerConnectionLike,
  type SinkSignalingChannel
} from "./signaling.js";

/**
 * Local WebRTC preview sink.
 *
 * Delivers the rendered video frames to a local peer over a WebRTC data
 * channel. The handshake is a self-contained local SDP exchange: this sink
 * mints a peer, creates a data channel, emits an offer through the supplied
 * `signaling` channel, and waits for the consumer's answer before delivering
 * frames. See `signaling.ts` for the abstractions and the loopback transport
 * used by the verify path.
 */
export interface LocalSinkConfig {
  /** Local SDP signaling channel (sink emits offer, consumer answers). */
  readonly signaling: SinkSignalingChannel;
  /**
   * Stream/market id this sink publishes (issue 7: per-stream feed). When set,
   * the control cell and feed are scoped to this id so each stream gets ITS own
   * feed rather than one global static asset. Optional for back-compat with the
   * in-process verify path.
   */
  readonly streamId?: string;
  /** Optional override of the WebRTC peer factory (tests inject a loopback). */
  readonly peerConnectionFactory?: RtcPeerConnectionFactory;
  /** Data channel label; defaults to `livestreak-video`. */
  readonly channelLabel?: string;
  /** Milliseconds to wait for the data channel to open; defaults to 5000. */
  readonly connectTimeoutMs?: number;
}

export interface LocalSinkDriverOptions {
  /** Default peer factory used when the config does not supply one. */
  readonly peerConnectionFactory?: RtcPeerConnectionFactory;
  /** Default connect timeout in milliseconds. */
  readonly connectTimeoutMs?: number;
}

import {
  localSinkCloseCommand,
  localSinkConfigureCommand
} from "./commands.js";

const attachmentId = "local-preview";
const defaultChannelLabel = "livestreak-video";
const defaultConnectTimeoutMs = 5000;

interface LocalVideoFrame {
  readonly bytes: Uint8Array;
}

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

export const localSinkDescriptor: SinkDriverDescriptor = {
  kind: "publish",
  id: "local",
  version: "0.1.0",
  displayName: "Local Preview Sink",
  summary: "Deliver rendered video to a local peer over WebRTC.",
  capabilityScopes: ["sink:local:*"],
  flags: [
    flag(
      "channelLabel",
      stringValue("WebRTC data channel label for delivered video frames."),
      "Override the data channel label used for local WebRTC delivery."
    )
  ],
  commands: [localSinkConfigureCommand, localSinkCloseCommand],
  mode: "local",
  requiresHost: false,
  debugOnly: false
};

export const validateLocalSinkConfig = (
  config: LocalSinkConfig
): Effect.Effect<LocalSinkConfig, LiveStreakError> =>
  Effect.gen(function* () {
    if (config.signaling === null || typeof config.signaling !== "object") {
      return yield* Effect.fail(configError("Local sink requires a signaling channel"));
    }
    if (typeof config.signaling.publishOffer !== "function") {
      return yield* Effect.fail(
        configError("Local sink signaling channel must provide publishOffer")
      );
    }
    if (config.channelLabel !== undefined && config.channelLabel.trim().length === 0) {
      return yield* Effect.fail(configError("Local sink channelLabel must not be empty"));
    }
    if (
      config.connectTimeoutMs !== undefined &&
      (!Number.isFinite(config.connectTimeoutMs) || config.connectTimeoutMs <= 0)
    ) {
      return yield* Effect.fail(
        configError("Local sink connectTimeoutMs must be a positive number")
      );
    }

    return config;
  });

export const createLocalSinkDriver = (
  options: LocalSinkDriverOptions = {}
): SinkDriver<LocalSinkConfig> => ({
  descriptor: localSinkDescriptor,
  mode: "local",
  validate: validateLocalSinkConfig,
  describeControl: (config, context) =>
    Effect.succeed(describeLocalSinkCell(config, context)),
  attach: (config) =>
    Effect.gen(function* () {
      const channelLabel = config.channelLabel ?? defaultChannelLabel;
      const connectTimeoutMs =
        config.connectTimeoutMs ?? options.connectTimeoutMs ?? defaultConnectTimeoutMs;

      const factory =
        config.peerConnectionFactory ??
        options.peerConnectionFactory ??
        (yield* resolveDefaultPeerFactory());

      const stats = {
        deliveredItems: 0,
        status: "starting" as "starting" | "running" | "stopped" | "failed",
        message: `local sink delivering over WebRTC channel ${channelLabel}`
      };

      const peer = factory();
      const channel = peer.createDataChannel(channelLabel);

      let finalized = false;

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (!finalized) {
            channel.close();
            peer.close();
          }
        }).pipe(Effect.catchAll(() => Effect.void))
      );

      // Perform the local SDP handshake: offer -> publish -> await answer.
      yield* handshake(peer, channel, config.signaling, connectTimeoutMs);
      stats.status = "running";

      const deliver = (item: SinkDeliveryItem): Effect.Effect<void, LiveStreakError> =>
        Effect.gen(function* () {
          if (item.kind === "marker") {
            return;
          }
          const frame = yield* readVideoFrame(item.payload);
          yield* sendFrame(channel, frame);
          stats.deliveredItems += 1;
        });

      const finalize: Effect.Effect<SinkFinalizeResult, LiveStreakError> = Effect.sync(() => {
        if (!finalized) {
          finalized = true;
          channel.close();
          peer.close();
          stats.status = "stopped";
        }
        return {
          deliveredItems: stats.deliveredItems,
          output: { kind: "memory" }
        };
      });

      const health: Effect.Effect<SinkStageHealth, LiveStreakError> = Effect.sync(() => ({
        stage: "publish",
        descriptorId: localSinkDescriptor.id,
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

const describeLocalSinkCell = (
  config: LocalSinkConfig,
  context: DescribeControlContext
): ControlCellDefinition => {
  const nowMs = context.nowMs ?? Date.now();
  const instanceId = context.instanceId ?? config.streamId ?? "local-preview";

  return {
    id: `sink:${instanceId}`,
    cell: {
      label: "Local Preview",
      catalog: "sink:local",
      status: ["idle", null, nowMs],
      settings: {
        channelLabel: config.channelLabel ?? defaultChannelLabel,
        subscribe: ["publish.video.rendered"]
      },
      readonly: config.streamId === undefined ? {} : { streamId: config.streamId },
      functions: []
    }
  };
};

const handshake = (
  peer: RtcPeerConnectionLike,
  channel: RtcDataChannelLike,
  signaling: SinkSignalingChannel,
  connectTimeoutMs: number
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    const opened = whenChannelOpen(channel);

    const offer = yield* Effect.tryPromise({
      try: () => peer.createOffer(),
      catch: (cause) => runtimeError("Local sink failed to create an offer", cause)
    });
    yield* Effect.tryPromise({
      try: () => peer.setLocalDescription(offer),
      catch: (cause) => runtimeError("Local sink failed to set the local description", cause)
    });

    yield* signaling.publishOffer(offer);

    const answer = yield* signaling.awaitAnswer;
    yield* Effect.tryPromise({
      try: () => peer.setRemoteDescription(answer),
      catch: (cause) => runtimeError("Local sink failed to set the remote description", cause)
    });

    yield* opened.pipe(
      Effect.timeoutFail({
        duration: `${connectTimeoutMs} millis`,
        onTimeout: () =>
          new LiveStreakRuntimeError({
            message: "Local sink timed out waiting for the WebRTC data channel to open"
          })
      })
    );
  });

const whenChannelOpen = (channel: RtcDataChannelLike): Effect.Effect<void, never> =>
  Effect.async<void>((resume) => {
    if (channel.readyState === "open") {
      resume(Effect.void);
      return;
    }
    channel.onopen = () => resume(Effect.void);
  });

const sendFrame = (
  channel: RtcDataChannelLike,
  frame: LocalVideoFrame
): Effect.Effect<void, LiveStreakError> =>
  Effect.try({
    try: () => channel.send(frame.bytes),
    catch: (cause) => runtimeError("Local sink failed to send a video frame", cause)
  });

const readVideoFrame = (payload: unknown): Effect.Effect<LocalVideoFrame, LiveStreakError> =>
  Effect.gen(function* () {
    if (payload === null || typeof payload !== "object") {
      return yield* Effect.fail(configError("Local sink received an invalid video payload"));
    }
    const candidate = payload as { data?: unknown };
    if (!(candidate.data instanceof Uint8Array)) {
      return yield* Effect.fail(
        configError("Local sink received a video payload without frame bytes")
      );
    }
    if (candidate.data.byteLength === 0) {
      return yield* Effect.fail(configError("Local sink received an empty video frame"));
    }
    return { bytes: candidate.data };
  });

const runtimeError = (message: string, cause: unknown): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message,
    metadata: { details: cause instanceof Error ? cause.message : String(cause) }
  });
