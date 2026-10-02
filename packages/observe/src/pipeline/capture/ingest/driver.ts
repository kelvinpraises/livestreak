import { Effect, Queue, Stream } from "effect";
import { LiveStreakConfigError } from "@livestreak/core";
import { nowTimePoint } from "@livestreak/schema";
import type {
  CaptureDriver,
  CaptureDriverDescriptor,
  CaptureLiveControls,
  CaptureLivePauseState,
  CaptureStageHealth,
  FrameSource,
  RawFrame
} from "#pipeline/capture/types.js";
import type { DescribeControlContext, ControlCellDefinition } from "#run/control/bus/types.js";
import {
  ingestCaptureCloseCommand,
  ingestCaptureConfigureCommand
} from "./commands.js";

export interface IngestCaptureConfig {
  /** Loopback TCP port the bot POSTs frames to. Default {@link DEFAULT_INGEST_PORT}. */
  readonly port?: number;
  /** Ingest path. Default "/frames". */
  readonly path?: string;
  /** Frame dimensions in pixels (required — the bot's contract, no guessing). */
  readonly width: number;
  readonly height: number;
  /** Expected frames per second (required). */
  readonly fps: number;
  /** Pixel layout the bot sends. Default "rgba". */
  readonly byteFormat?: "rgba" | "yuv420p";
  /** Bounded queue depth (backpressure: full → 429 so the bot slows down). Default 120. */
  readonly maxQueuedFrames?: number;
}

export const DEFAULT_INGEST_PORT = 48710;

interface ResolvedIngestCaptureConfig {
  readonly port: number;
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly byteFormat: "rgba" | "yuv420p";
  readonly maxQueuedFrames: number;
}

const defaultConfig = {
  port: DEFAULT_INGEST_PORT,
  path: "/frames",
  byteFormat: "rgba",
  maxQueuedFrames: 120
} as const;

export const ingestCaptureDescriptor: CaptureDriverDescriptor = {
  kind: "capture",
  id: "ingest",
  version: "0.1.0",
  displayName: "Ingest Capture",
  summary: "Bot-pushed rendered frames over loopback HTTP for generated shows.",
  capabilityScopes: ["capture:ingest:*"],
  flags: [],
  commands: [ingestCaptureConfigureCommand, ingestCaptureCloseCommand],
  sourceType: "stream",
  sourceMode: "live"
};

const configError = (message: string): LiveStreakConfigError =>
  new LiveStreakConfigError({ message });

export const validateIngestCaptureConfig = (
  config: IngestCaptureConfig
): Effect.Effect<ResolvedIngestCaptureConfig, LiveStreakConfigError> => {
  const port = config.port ?? defaultConfig.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Effect.fail(configError("Ingest capture port must be an integer in 1..65535"));
  }
  const path = config.path ?? defaultConfig.path;
  if (path.length === 0 || !path.startsWith("/")) {
    return Effect.fail(configError('Ingest capture path must start with "/"'));
  }
  // G14-B05: safe integers only — unsafe widths compute Infinity byte counts and defeat the
  // HTTP body bound. No new product memory cap; just exact arithmetic.
  if (!Number.isSafeInteger(config.width) || config.width < 1 || config.width % 2 !== 0) {
    return Effect.fail(configError("Ingest capture requires a safe positive EVEN width (I420 chroma shares 2x2 blocks)"));
  }
  if (!Number.isSafeInteger(config.height) || config.height < 1 || config.height % 2 !== 0) {
    return Effect.fail(configError("Ingest capture requires a safe positive EVEN height (I420 chroma shares 2x2 blocks)"));
  }
  if (!Number.isFinite(config.fps) || config.fps <= 0) {
    return Effect.fail(configError("Ingest capture requires a positive fps"));
  }
  const byteFormat = config.byteFormat ?? defaultConfig.byteFormat;
  if (byteFormat !== "rgba" && byteFormat !== "yuv420p") {
    return Effect.fail(configError('Ingest capture byteFormat must be "rgba" or "yuv420p"'));
  }
  const maxQueuedFrames = config.maxQueuedFrames ?? defaultConfig.maxQueuedFrames;
  if (!Number.isSafeInteger(maxQueuedFrames) || maxQueuedFrames < 1) {
    return Effect.fail(configError("Ingest capture maxQueuedFrames must be a safe positive integer"));
  }
  // G18-B03: safe operands do not imply a safe product — validate the SELECTED format's
  // byte count before acquisition/listening.
  const byteCount =
    byteFormat === "rgba"
      ? config.width * config.height * 4
      : (config.width * config.height * 3) / 2;
  if (!Number.isSafeInteger(byteCount) || byteCount <= 0) {
    return Effect.fail(
      configError(
        `Ingest capture frame byte count must be a safe positive integer, got ${byteCount} for ${config.width}x${config.height} ${byteFormat}`
      )
    );
  }
  return Effect.succeed({ port, path, width: config.width, height: config.height, fps: config.fps, byteFormat, maxQueuedFrames });
};

// The byte product itself was validated above (safe even dims alone do NOT imply it); both
// products are exact here — no floor.
const frameBytes = (config: ResolvedIngestCaptureConfig): number =>
  config.byteFormat === "rgba"
    ? config.width * config.height * 4
    : (config.width * config.height * 3) / 2;

export const createIngestCaptureDriver = (): CaptureDriver<IngestCaptureConfig> => ({
  descriptor: ingestCaptureDescriptor,
  validate: validateIngestCaptureConfig,
  describeControl: (_config, context) =>
    Effect.succeed(describeIngestCaptureCell(context)),
  create: (config) =>
    Effect.gen(function* () {
      const resolved = yield* validateIngestCaptureConfig(config);
      const stats = { frameCount: 0, droppedFrames: 0 };
      const sourceId = "capture:ingest";
      const expected = frameBytes(resolved);
      let sequence = 0;
      // ONE source-owned mutable state object (X4 ruling): read synchronously by the HTTP
      // admission callback and updated through Effect.sync by pause/resume/snapshot. No Ref plus
      // mirror — two truths invite divergence. Plain mutation is purity-safe (no Effect.run*).
      const controlState = { paused: false, revision: 0 };
      const readPauseState = (): CaptureLivePauseState => ({
        paused: controlState.paused,
        revision: controlState.revision
      });
      const live: CaptureLiveControls = {
        // Idempotent with transition-only revision (Q4): repeated calls without a real
        // transition neither bump revision nor disturb admission.
        pause: () =>
          Effect.sync(() => {
            if (!controlState.paused) {
              controlState.paused = true;
              controlState.revision += 1;
            }
            return readPauseState();
          }),
        resume: () =>
          Effect.sync(() => {
            if (controlState.paused) {
              controlState.paused = false;
              controlState.revision += 1;
            }
            return readPauseState();
          }),
        snapshot: Effect.sync(readPauseState)
      };

      // M2-02: bound the source prefetch to queue capacity plus at most one pending result.
      // fromQueue without maxChunkSize can hand a whole backlog in one pull, which
      // capture-pull buffers outside the queue and lets it refill behind the bound.
      const queue = yield* Queue.bounded<RawFrame>(resolved.maxQueuedFrames);
      yield* Effect.addFinalizer(() => Queue.shutdown(queue));

      // Lazy Node import: observe's barrel is bundled into the browser app too, and ingest
      // serving is a Node-only concern (same reason the live sink's ws import is lazy).
      const { createServer } = yield* Effect.tryPromise({
        try: () => import("node:http"),
        catch: () => configError("Ingest capture needs a Node runtime to serve its loopback endpoint")
      });

      const server = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            new Promise<import("node:http").Server>((resolve, reject) => {
              const srv = createServer((req, res) => {
                if (req.method !== "POST" || req.url !== resolved.path) {
                  res.writeHead(404).end();
                  return;
                }
                const chunks: Buffer[] = [];
                let size = 0;
                req.on("data", (chunk: Buffer) => {
                  size += chunk.length;
                  if (size > expected) {
                    res.writeHead(413).end();
                    req.destroy();
                    return;
                  }
                  chunks.push(chunk);
                });
                req.on("end", () => {
                  const body = Buffer.concat(chunks);
                  if (body.length !== expected) {
                    res.writeHead(400, { "content-type": "application/json" }).end(
                      JSON.stringify({ error: `frame must be exactly ${expected} bytes, got ${body.length}` })
                    );
                    return;
                  }
                  // Paused admission (Q4): recheck at body-complete time — a request begun before
                  // pause must not slip through afterward. Refused frames advance neither sequence
                  // nor accepted count, and count as drops like full-queue refusals. Listener stays open.
                  if (controlState.paused) {
                    stats.droppedFrames += 1;
                    res.writeHead(429, { "content-type": "application/json" }).end(
                      JSON.stringify({ error: "ingest paused", reason: "paused" })
                    );
                    return;
                  }
                  const frame: RawFrame = {
                    id: `${sourceId}:${sequence}`,
                    sourceId,
                    time: nowTimePoint(Date.now()),
                    cadence: {
                      mode: "capture",
                      expectedFps: resolved.fps,
                      sequence,
                      droppedFrames: stats.droppedFrames
                    },
                    payload: {
                      width: resolved.width,
                      height: resolved.height,
                      byteFormat: resolved.byteFormat,
                      encoding: "raw",
                      expectedFps: resolved.fps,
                      data: new Uint8Array(body)
                    }
                  };
                  // Synchronous boundary: Queue.unsafeOffer never suspends, so a full queue
                  // answers 429 HERE instead of hanging the POST. (Queue.offer would block
                  // until a take frees space — that parked every POST under load.) This is also
                  // the purity-compliant callback bridge: no Effect.run* in library code.
                  if (Queue.unsafeOffer(queue, frame)) {
                    stats.frameCount += 1;
                    res.writeHead(200, { "content-type": "application/json" }).end(
                      JSON.stringify({ seq: sequence })
                    );
                    sequence += 1;
                  } else {
                    stats.droppedFrames += 1;
                    res.writeHead(429, { "content-type": "application/json" }).end(
                      JSON.stringify({ error: "ingest queue full — slow down" })
                    );
                  }
                });
              });
              srv.once("error", reject);
              srv.listen(resolved.port, "127.0.0.1", () => {
                srv.removeListener("error", reject);
                resolve(srv);
              });
            }),
          catch: (cause) =>
            configError(`Ingest capture could not listen on 127.0.0.1:${resolved.port} — ${String(cause)}`)
        }),
        (srv) =>
          // G18-B04: bounded release that never awaits producer cooperation. Stop listening
          // FIRST (close), then destroy idle and in-flight sockets (closeAllConnections) so the
          // close callback resolves promptly. NOTE on finalizer order: Effect acquireRelease
          // releases LIFO, so this server release runs BEFORE the queue shutdown registered
          // earlier — admission is stopped by the closing listener, not by an already-shut queue.
          // No silent fallback: closeAllConnections exists on the supported Node runtime.
          Effect.promise(
            () =>
              new Promise<void>((resolve) => {
                srv.close(() => resolve());
                srv.closeAllConnections();
              })
          )
      );
      server.unref?.();

      const health: Effect.Effect<CaptureStageHealth, never> = Effect.sync(() => ({
        stage: "capture",
        descriptorId: ingestCaptureDescriptor.id,
        status: "running",
        updatedAtMs: Date.now(),
        sourceId,
        frameCount: stats.frameCount,
        droppedFrames: stats.droppedFrames,
        cadence: {
          mode: "capture",
          expectedFps: resolved.fps,
          sequence,
          droppedFrames: stats.droppedFrames
        }
      }));

      const frameSource: FrameSource = {
        descriptor: ingestCaptureDescriptor,
        frames: Stream.fromQueue(queue, { maxChunkSize: 1 }),
        health,
        live
      };
      return frameSource;
    })
});

const describeIngestCaptureCell = (
  context: DescribeControlContext
): ControlCellDefinition => {
  const nowMs = context.nowMs ?? Date.now();

  return {
    id: "capture:ingest",
    cell: {
      label: "Ingest Capture",
      catalog: "capture:ingest",
      status: ["idle", null, nowMs],
      settings: {},
      readonly: {
        sourceType: "stream",
        sourceMode: "live"
      },
      functions: []
    }
  };
};
