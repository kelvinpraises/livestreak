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
// Type-only: the encoder pulls in the Node ffmpeg adapter (child_process), and observe's barrel is bundled
// into the browser consumer app — so the IMPLEMENTATION is loaded via a dynamic import only on the runtime
// `deliverAs: "mp4"` path (see encodeFrameSink), never statically.
import type { Mp4EncoderInputFormat, Mp4VideoEncoder } from "#pipeline/publish/encoder/mp4.js";

const importEncoderModule = (): Promise<typeof import("../../encoder/mp4.js")> =>
  import(/* @vite-ignore */ "../../encoder/mp4.js");
const importNodeModule = (specifier: string): Promise<unknown> =>
  import(/* @vite-ignore */ specifier);

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
  /**
   * How delivered frames are placed on the wire.
   *  - `"raw"` (default): each frame's bytes are sent verbatim — the in-process loopback / verify path.
   *  - `"mp4"`: the runtime browser preview. Delivered RAW RGB frames are encoded into a single MP4 (the
   *    `<video>` consumer cannot decode raw RGB24), then streamed over the channel at finalize with
   *    backpressure + a full drain before close. Set by the live run config (board-run-config).
   */
  readonly deliverAs?: "raw" | "mp4";
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

      // Encode mode buffers each delivered RGB frame into an MP4 (ffmpeg), streamed at finalize. Raw mode
      // forwards bytes verbatim per delivery (loopback/verify path).
      const mp4Sink =
        (config.deliverAs ?? "raw") === "mp4"
          ? createMp4FrameEncoderSink(config.streamId ?? "preview")
          : undefined;

      let finalized = false;

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          if (!finalized) {
            if (mp4Sink !== undefined) {
              yield* mp4Sink.dispose;
            }
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
          if (mp4Sink !== undefined) {
            yield* mp4Sink.writeFrame(item.payload);
          } else {
            const frame = yield* readVideoFrame(item.payload);
            yield* sendFrame(channel, frame);
          }
          stats.deliveredItems += 1;
        });

      const finalize: Effect.Effect<SinkFinalizeResult, LiveStreakError> = Effect.gen(function* () {
        if (finalized) {
          return { deliveredItems: stats.deliveredItems, output: { kind: "memory" } };
        }
        finalized = true;

        if (mp4Sink !== undefined) {
          // Encode the buffered frames into a single MP4 and stream it over the channel. Fail-soft: a flush
          // error still drains+closes so the consumer's transfer terminates (it falls back to the recording)
          // instead of hanging the viewer.
          yield* mp4Sink.flushToChannel(channel).pipe(
            Effect.catchAll(() => {
              stats.status = "failed";
              stats.message = "local sink MP4 encode/flush failed";
              return Effect.void;
            })
          );
        }

        // Drain the send buffer fully BEFORE closing — closing with bytes still queued discards them (this
        // was the ~32 KB truncation that rendered black). Then close the channel, grace, then the peer.
        yield* drainAndClose(channel, peer);
        if (stats.status !== "failed") {
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

    // Non-trickle ICE: embed the gathered candidates in the offer before publishing — the signaling relays
    // only the SDP, so without this the browser never learns where to connect and the channel never opens.
    const localOffer = yield* Effect.tryPromise({
      try: () => peer.localDescriptionWithCandidates(offer),
      catch: (cause) => runtimeError("Local sink failed to gather ICE candidates", cause)
    });

    yield* signaling.publishOffer(localOffer);

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

// --- encode-mode delivery (runtime browser preview) ---
//
// The capture stage decodes the source file to RAW RGB24 frames (for downstream CV), which a `<video>`
// element cannot decode. For the browser preview we re-encode those frames into a single MP4 with ffmpeg
// and stream the complete file over the data channel. The consumer (app/src/utils/webrtc-consumer.ts)
// collects the chunks and plays the assembled MP4 blob — so the bytes on the wire MUST be a valid MP4,
// not raw pixels.

const SEND_CHUNK_BYTES = 16 * 1024;
const BACKPRESSURE_HIGH_BYTES = 8 * 1024 * 1024;
const BACKPRESSURE_LOW_BYTES = 1 * 1024 * 1024;
const DRAIN_TIMEOUT_MS = 30_000;
const CLOSE_GRACE_MS = 400;

let encodeTempCounter = 0;

interface NodeFsPromises {
  readonly readFile: (path: string) => Promise<Uint8Array>;
  readonly unlink: (path: string) => Promise<void>;
}

interface EncodeFrame {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly inputFormat: Mp4EncoderInputFormat;
}

interface Mp4FrameEncoderSink {
  /** Encode one delivered frame (lazily spawns ffmpeg on the first, sized + paced from the frame). */
  readonly writeFrame: (payload: unknown) => Effect.Effect<void, LiveStreakError>;
  /** Finalize the encoder and stream the complete MP4 over the channel (backpressure + full drain). */
  readonly flushToChannel: (channel: RtcDataChannelLike) => Effect.Effect<void, LiveStreakError>;
  /** Best-effort teardown if the run aborts before flush (closes ffmpeg, removes the temp file). */
  readonly dispose: Effect.Effect<void, never>;
}

const createMp4FrameEncoderSink = (streamId: string): Mp4FrameEncoderSink => {
  let encoder: Mp4VideoEncoder | undefined;
  let outputPath: string | undefined;
  let done = false;

  const ensureEncoder = (frame: EncodeFrame): Effect.Effect<Mp4VideoEncoder, LiveStreakError> =>
    Effect.gen(function* () {
      if (encoder !== undefined) {
        return encoder;
      }
      outputPath = yield* Effect.promise(() => encodeTempPath(streamId));
      const mod = yield* Effect.tryPromise({
        try: () => importEncoderModule(),
        catch: (cause) => runtimeError("Local sink failed to load the MP4 encoder", cause)
      });
      encoder = yield* mod.createMp4VideoEncoder({
        outputPath,
        width: frame.width,
        height: frame.height,
        fps: frame.fps,
        inputFormat: frame.inputFormat
      });
      return encoder;
    });

  const writeFrame = (payload: unknown): Effect.Effect<void, LiveStreakError> =>
    Effect.gen(function* () {
      const frame = yield* readEncodeFrame(payload);
      const active = yield* ensureEncoder(frame);
      yield* active.writeFrame(frame.bytes);
    });

  const flushToChannel = (channel: RtcDataChannelLike): Effect.Effect<void, LiveStreakError> =>
    Effect.gen(function* () {
      if (done) {
        return;
      }
      done = true;
      if (encoder === undefined || outputPath === undefined) {
        return; // no frames arrived — nothing to encode
      }
      const path = outputPath;
      yield* encoder.finalize;
      const fs = yield* loadFsPromises();
      const mp4 = yield* Effect.tryPromise({
        try: () => fs.readFile(path),
        catch: (cause) => runtimeError("Local sink failed to read the encoded MP4", cause)
      });
      yield* streamBytesOverChannel(channel, mp4);
      yield* Effect.promise(() => fs.unlink(path).catch(() => undefined));
    });

  const dispose: Effect.Effect<void, never> = Effect.gen(function* () {
    if (done || encoder === undefined) {
      return;
    }
    done = true;
    yield* encoder.finalize.pipe(Effect.catchAll(() => Effect.void)); // close ffmpeg stdin so it exits
    if (outputPath !== undefined) {
      const path = outputPath;
      const fs = yield* loadFsPromises();
      yield* Effect.promise(() => fs.unlink(path).catch(() => undefined));
    }
  }).pipe(Effect.catchAll(() => Effect.void));

  return { writeFrame, flushToChannel, dispose };
};

const loadFsPromises = (): Effect.Effect<NodeFsPromises, LiveStreakError> =>
  Effect.tryPromise({
    try: () => importNodeModule("node:fs/promises") as Promise<NodeFsPromises>,
    catch: (cause) => runtimeError("Local sink failed to load node:fs/promises", cause)
  });

const encodeTempPath = async (streamId: string): Promise<string> => {
  const os = (await importNodeModule("node:os")) as { tmpdir: () => string };
  const path = (await importNodeModule("node:path")) as { join: (...parts: string[]) => string };
  const safe = streamId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "preview";
  return path.join(os.tmpdir(), `livestreak-sink-${safe}-${Date.now()}-${encodeTempCounter++}.mp4`);
};

const readEncodeFrame = (payload: unknown): Effect.Effect<EncodeFrame, LiveStreakError> =>
  Effect.gen(function* () {
    if (payload === null || typeof payload !== "object") {
      return yield* Effect.fail(configError("Local sink received an invalid video payload"));
    }
    const candidate = payload as {
      data?: unknown;
      width?: unknown;
      height?: unknown;
      expectedFps?: unknown;
      byteFormat?: unknown;
    };
    if (!(candidate.data instanceof Uint8Array) || candidate.data.byteLength === 0) {
      return yield* Effect.fail(
        configError("Local sink received a video payload without frame bytes")
      );
    }
    if (
      typeof candidate.width !== "number" ||
      typeof candidate.height !== "number" ||
      candidate.width <= 0 ||
      candidate.height <= 0
    ) {
      return yield* Effect.fail(
        configError("Local sink MP4 encode requires positive frame width and height")
      );
    }
    const fps =
      typeof candidate.expectedFps === "number" && candidate.expectedFps > 0
        ? candidate.expectedFps
        : 30;
    const inputFormat: Mp4EncoderInputFormat =
      candidate.byteFormat === "jpeg" || candidate.byteFormat === "png" ? candidate.byteFormat : "rgb";
    return { bytes: candidate.data, width: candidate.width, height: candidate.height, fps, inputFormat };
  });

/** Resolve once the channel's send buffer is at/below `threshold` (or it closed, or we time out). */
const waitForBufferedAmountBelow = (
  channel: RtcDataChannelLike,
  threshold: number,
  timeoutMs: number
): Effect.Effect<void, never> =>
  Effect.async<void>((resume) => {
    const deadline = Date.now() + timeoutMs;
    const check = (): void => {
      if (
        (channel.bufferedAmount ?? 0) <= threshold ||
        channel.readyState !== "open" ||
        Date.now() >= deadline
      ) {
        resume(Effect.void);
        return;
      }
      setTimeout(check, 20);
    };
    check();
  });

/** Stream a complete byte buffer over the channel in chunks with backpressure, then wait for a full drain. */
const streamBytesOverChannel = (
  channel: RtcDataChannelLike,
  bytes: Uint8Array
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    for (let offset = 0; offset < bytes.byteLength; offset += SEND_CHUNK_BYTES) {
      if ((channel.bufferedAmount ?? 0) >= BACKPRESSURE_HIGH_BYTES) {
        yield* waitForBufferedAmountBelow(channel, BACKPRESSURE_LOW_BYTES, DRAIN_TIMEOUT_MS);
      }
      const end = Math.min(offset + SEND_CHUNK_BYTES, bytes.byteLength);
      const chunk = bytes.subarray(offset, end);
      yield* Effect.try({
        try: () => channel.send(chunk),
        catch: (cause) => runtimeError("Local sink failed to send an encoded video chunk", cause)
      });
    }
    yield* waitForBufferedAmountBelow(channel, 0, DRAIN_TIMEOUT_MS);
  });

/** Drain the channel, close it, then close the peer after a grace so the close reaches the consumer. */
const drainAndClose = (
  channel: RtcDataChannelLike,
  peer: RtcPeerConnectionLike
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    yield* waitForBufferedAmountBelow(channel, 0, DRAIN_TIMEOUT_MS);
    channel.close();
    // Grace so the SCTP stream-reset (channel close) reaches the consumer before peer.close() tears down the
    // DTLS transport — otherwise the consumer may never see `onclose` and relies on its idle fallback.
    yield* Effect.sleep(`${CLOSE_GRACE_MS} millis`);
    peer.close();
  });
