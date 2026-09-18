import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type {
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
import { localIpv4 } from "./upnp.js";
import { probeReachability, type ProbeInput, type ReachabilityResult } from "./probe.js";
import { createDirectFanout, DEFAULT_DIRECT_FANOUT, type DirectFanout } from "./fanout.js";
import {
  createWsDirectViewerServer,
  directWatchUrl,
  type DirectServerFactory
} from "./transport.js";
import { createDirectSignalClient, type DirectSignalClient } from "./signal.js";
import { directSinkCloseCommand, directSinkConfigureCommand } from "./commands.js";

/** Factory for the fMP4 encoder; the real one spawns ffmpeg, tests inject a synthetic one. */
type Fmp4EncoderFactory = (
  config: Fmp4EncoderConfig
) => Effect.Effect<Fmp4Encoder, LiveStreakError>;

export type ReachabilityProber = (input: ProbeInput) => Promise<ReachabilityResult>;

/**
 * Direct-serve fMP4 sink — the broadcaster IS the byte plane.
 *
 * Encode ONCE (same fMP4 pipeline as the live sink), then fan the bytes out to up to `maxViewers`
 * viewers who dialed the broadcaster DIRECTLY. The host does signaling only: it verifies the door
 * from outside (reachability echo) and publishes the watch URL (announce); no media byte transits it.
 * Reachability is an ELIGIBILITY gate: attach fails with an operator-facing message when no publicly
 * dialable door can be opened — an unreachable broadcaster cannot go live on the direct lane.
 */
export interface DirectSinkConfig {
  readonly streamId: string;
  /** Host base URL for signaling (echo + announce) — never for media. */
  readonly hostBaseUrl?: string;
  readonly port?: number;
  readonly maxViewers?: number;
  /** `require` gates go-live on a verified public door; `lan` serves the local network (dev/demo). */
  readonly reachability?: "require" | "lan";
  readonly fragmentSeconds?: number;
  readonly binaries?: FfmpegBinaries;
}

export interface DirectSinkDriverOptions {
  readonly fragmentSeconds?: number;
  readonly binaries?: FfmpegBinaries;
  readonly encoderFactory?: Fmp4EncoderFactory;
  /** Override the viewer server (tests); defaults to the WS server. */
  readonly serverFactory?: DirectServerFactory;
  /** Override the reachability ladder (tests); defaults to UPnP → STUN. */
  readonly prober?: ReachabilityProber;
  /** Override the host signaling client (tests). */
  readonly signalFactory?: (hostBaseUrl: string) => DirectSignalClient;
}

const attachmentId = "direct-fmp4";
const defaultFragmentSeconds = 1;
export const DEFAULT_DIRECT_PORT = 48700;
// Host announces expire (TTL) unless refreshed — heartbeat well inside the host's window so a
// crashed broadcaster's door disappears but a live one never flickers out of the lookup.
const ANNOUNCE_HEARTBEAT_MS = 30_000;
// Bound the end-of-stream drain: give viewer pipelines a moment to ship the queued tail + end
// signal before the server force-closes sockets, but never let one dead peer hold teardown.
const DRAIN_TIMEOUT_MS = 3_000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
  });

const configError = (message: string): LiveStreakConfigError =>
  new LiveStreakConfigError({ message });

export const directSinkDescriptor: SinkDriverDescriptor = {
  kind: "publish",
  id: "direct",
  version: "0.1.0",
  displayName: "Direct Stream Sink",
  summary: "Encode-once fMP4 served to viewers DIRECTLY by the broadcaster; host does signaling only.",
  capabilityScopes: ["sink:direct:*"],
  flags: [
    {
      name: "streamId",
      value: { type: "string", description: "Stream/market id this direct feed is scoped to." },
      help: "Scope the direct fMP4 feed to a stream id."
    },
    {
      name: "port",
      value: { type: "number", description: "TCP port viewers dial.", default: DEFAULT_DIRECT_PORT },
      help: "UPnP-mapped on the router; viewers connect to it directly."
    }
  ],
  commands: [directSinkConfigureCommand, directSinkCloseCommand],
  mode: "local",
  requiresHost: false,
  debugOnly: false
};

export const validateDirectSinkConfig = (
  config: DirectSinkConfig
): Effect.Effect<DirectSinkConfig, LiveStreakError> =>
  Effect.gen(function* () {
    if (typeof config.streamId !== "string" || config.streamId.trim().length === 0) {
      return yield* Effect.fail(configError("Direct sink requires a streamId"));
    }
    if (
      config.port !== undefined &&
      (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    ) {
      return yield* Effect.fail(configError("Direct sink port must be an integer in 1..65535"));
    }
    if (
      config.maxViewers !== undefined &&
      (!Number.isInteger(config.maxViewers) || config.maxViewers < 1)
    ) {
      return yield* Effect.fail(configError("Direct sink maxViewers must be a positive integer"));
    }
    if (
      config.reachability !== undefined &&
      config.reachability !== "require" &&
      config.reachability !== "lan"
    ) {
      return yield* Effect.fail(configError('Direct sink reachability must be "require" or "lan"'));
    }
    if (config.reachability !== "lan" && config.hostBaseUrl === undefined) {
      return yield* Effect.fail(
        configError("Direct sink requires hostBaseUrl for the reachability echo (or reachability: 'lan')")
      );
    }
    if (
      config.fragmentSeconds !== undefined &&
      (!Number.isFinite(config.fragmentSeconds) || config.fragmentSeconds <= 0)
    ) {
      return yield* Effect.fail(configError("Direct sink fragmentSeconds must be a positive number"));
    }
    return config;
  });

interface ServeState {
  readonly fanout: DirectFanout;
  readonly watchUrl: string;
  readonly grade: string;
  /** Ownership receipt from the first announce; heartbeats and the final withdraw carry it. */
  readonly announceKey: string | undefined;
  readonly closeServer: () => Promise<void>;
  readonly closeProbe: () => Promise<void>;
}

export const createDirectSinkDriver = (
  options: DirectSinkDriverOptions = {}
): SinkDriver<DirectSinkConfig> => ({
  descriptor: directSinkDescriptor,
  mode: "local",
  validate: validateDirectSinkConfig,
  describeControl: (config, context) => Effect.succeed(describeDirectSinkCell(config, context)),
  attach: (config) =>
    Effect.gen(function* () {
      const fragmentSeconds =
        config.fragmentSeconds ?? options.fragmentSeconds ?? defaultFragmentSeconds;
      const port = config.port ?? DEFAULT_DIRECT_PORT;
      const maxViewers = config.maxViewers ?? DEFAULT_DIRECT_FANOUT.maxViewers;
      const signal =
        config.hostBaseUrl === undefined
          ? undefined
          : (options.signalFactory ?? createDirectSignalClient)(config.hostBaseUrl);

      const serve = yield* openDoorAndServe({
        config,
        port,
        maxViewers,
        signal,
        serverFactory: options.serverFactory ?? createWsDirectViewerServer,
        prober: options.prober ?? probeReachability
      });

      const stats = {
        deliveredItems: 0,
        status: "running" as "running" | "stopped" | "failed"
      };

      let encoder: Fmp4Encoder | undefined;
      let fragmentSeq = 0;
      let finalized = false;

      // Keep the host announce fresh while serving; a successful refresh can re-mint the key
      // (e.g. the host restarted and lost the record).
      let announceKey = serve.announceKey;
      const heartbeat =
        signal === undefined
          ? undefined
          : setInterval(() => {
              void signal.announce(config.streamId, serve.watchUrl, announceKey).then((result) => {
                if (result.status === "ok" && result.key !== undefined) announceKey = result.key;
              });
            }, ANNOUNCE_HEARTBEAT_MS);
      (heartbeat as { unref?: () => void } | undefined)?.unref?.();

      const shipChunk = (chunk: { kind: "init" | "fragment"; data: Uint8Array }): void => {
        if (chunk.kind === "init") {
          serve.fanout.setInit(chunk.data);
        } else {
          serve.fanout.push({ seq: ++fragmentSeq, data: chunk.data });
        }
      };

      const teardown = Effect.gen(function* () {
        if (finalized) return;
        finalized = true;
        if (heartbeat !== undefined) clearInterval(heartbeat);
        if (encoder !== undefined) {
          yield* encoder.finalize.pipe(Effect.catchAll(() => Effect.void));
        }
        serve.fanout.end("stream_ended");
        // Let viewer pipelines ship the queued tail + end signal before sockets are force-closed.
        yield* Effect.promise(() =>
          Promise.race([serve.fanout.drained(), delay(DRAIN_TIMEOUT_MS)])
        );
        if (signal !== undefined) {
          yield* Effect.promise(() => signal.withdraw(config.streamId, announceKey).catch(() => undefined));
        }
        yield* Effect.promise(() => serve.closeServer().catch(() => undefined));
        yield* Effect.promise(() => serve.closeProbe().catch(() => undefined));
        if (stats.status !== "failed") stats.status = "stopped";
      });

      yield* Effect.addFinalizer(() => teardown.pipe(Effect.catchAll(() => Effect.void)));

      const deliver = (item: SinkDeliveryItem): Effect.Effect<void, LiveStreakError> =>
        Effect.gen(function* () {
          if (item.kind === "marker") {
            if (item.marker.kind === "eos") {
              yield* teardown;
            }
            return;
          }
          const frame = yield* readI420Frame(item.payload, "Direct");
          if (encoder === undefined) {
            const makeEncoder = options.encoderFactory ?? createFmp4Encoder;
            encoder = yield* makeEncoder({
              width: frame.width,
              height: frame.height,
              fps: frame.fps,
              fragmentSeconds,
              onChunk: shipChunk,
              binaries: config.binaries ?? options.binaries
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
        descriptorId: directSinkDescriptor.id,
        status: stats.status,
        message: `direct serve [${serve.grade}] ${serve.watchUrl} viewers=${serve.fanout.viewerCount()}/${maxViewers}`,
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

interface OpenDoorInput {
  readonly config: DirectSinkConfig;
  readonly port: number;
  readonly maxViewers: number;
  readonly signal: DirectSignalClient | undefined;
  readonly serverFactory: DirectServerFactory;
  readonly prober: ReachabilityProber;
}

// Serve-then-verify: the listener must exist before the echo dials, so the order is
// start server → open the door (UPnP) → verify from outside → announce. Any gate failure
// closes what was opened and fails attach with the exact reason — that IS the go-live gate.
const openDoorAndServe = (
  input: OpenDoorInput
): Effect.Effect<ServeState, LiveStreakError> =>
  Effect.gen(function* () {
    const { config } = input;
    const fanout = createDirectFanout({ ...DEFAULT_DIRECT_FANOUT, maxViewers: input.maxViewers });

    const server = yield* Effect.tryPromise({
      try: () => input.serverFactory({ port: input.port, streamId: config.streamId, fanout }),
      catch: (cause) =>
        configError(
          `Direct sink could not open its viewer server on port ${input.port} — ${String(cause)}`
        )
    });

    if (config.reachability === "lan") {
      const host = (yield* Effect.promise(() => localIpv4())) ?? "127.0.0.1";
      const watchUrl = directWatchUrl(host, server.port, config.streamId);
      const announceKey = yield* announceOrFail({
        signal: input.signal,
        streamId: config.streamId,
        watchUrl,
        cleanup: () => Promise.allSettled([server.close()])
      });
      return {
        fanout,
        watchUrl,
        grade: "lan",
        announceKey,
        closeServer: server.close,
        closeProbe: async () => {}
      };
    }

    const probe = yield* Effect.promise(() =>
      input.prober({
        port: server.port,
        protocol: "TCP",
        mappingDescription: `livestreak-direct-${config.streamId}`,
        ...(input.signal === undefined
          ? {}
          : { verify: (_ip: string, publicPort: number) => input.signal!.verifyReachable(publicPort) })
      })
    );

    const failGate = (reason: string): Effect.Effect<never, LiveStreakError> =>
      Effect.promise(() => Promise.allSettled([server.close(), probe.close()])).pipe(
        Effect.flatMap(() => Effect.fail(configError(reason)))
      );

    if (probe.grade === "unreachable" || probe.publicIp === undefined) {
      return yield* failGate(
        `Not eligible to go live on the direct lane: ${probe.detail}. ` +
          "Fix the router (enable UPnP), broadcast from a reachable box, or use the host live sink."
      );
    }
    if (input.signal !== undefined && !probe.verified) {
      return yield* failGate(
        `Not eligible to go live on the direct lane: the door looked open (${probe.detail}) but the host ` +
          "could not dial it back from outside. Check the router's port mapping and firewall."
      );
    }

    const watchUrl = directWatchUrl(probe.publicIp, probe.publicPort ?? server.port, config.streamId);
    const announceKey = yield* announceOrFail({
      signal: input.signal,
      streamId: config.streamId,
      watchUrl,
      cleanup: () => Promise.allSettled([server.close(), probe.close()])
    });
    return {
      fanout,
      watchUrl,
      grade: probe.grade,
      announceKey,
      closeServer: server.close,
      closeProbe: probe.close
    };
  });

// Announce is fail-open on host unavailability (a reachable broadcaster still goes live), but a
// CONFLICT is a gate failure: another broadcaster owns this stream's announce, and going live
// anyway would leave viewers watching someone else's bytes.
const announceOrFail = (input: {
  readonly signal: DirectSignalClient | undefined;
  readonly streamId: string;
  readonly watchUrl: string;
  readonly cleanup: () => Promise<unknown>;
}): Effect.Effect<string | undefined, LiveStreakError> =>
  Effect.gen(function* () {
    if (input.signal === undefined) {
      return undefined;
    }
    const announced = yield* Effect.promise(() =>
      input.signal!.announce(input.streamId, input.watchUrl)
    );
    if (announced.status === "conflict") {
      yield* Effect.promise(input.cleanup);
      return yield* Effect.fail(
        configError(
          `Not eligible to go live on the direct lane: stream "${input.streamId}" is already ` +
            "announced by another broadcaster. Stop the other node or wait for its announce to expire."
        )
      );
    }
    return announced.status === "ok" ? announced.key : undefined;
  });

const describeDirectSinkCell = (
  config: DirectSinkConfig,
  context: DescribeControlContext
): ControlCellDefinition => {
  const nowMs = context.nowMs ?? Date.now();
  const instanceId = context.instanceId ?? "direct";
  return {
    id: `sink:${instanceId}`,
    cell: {
      label: "Direct Stream",
      catalog: "sink:direct",
      status: ["idle", null, nowMs],
      settings: {
        transport: "fmp4-direct",
        subscribe: ["publish.video.rendered"]
      },
      readonly: config.streamId === undefined ? {} : { streamId: config.streamId },
      functions: []
    }
  };
};
