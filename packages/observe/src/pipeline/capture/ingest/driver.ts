import { Effect, Queue, Stream } from "effect";
import { LiveStreakConfigError } from "@livestreak/core";
import { nowTimePoint } from "@livestreak/schema";
import type {
  CaptureDriver,
  CaptureDriverDescriptor,
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
  if (!Number.isInteger(config.width) || config.width < 1) {
    return Effect.fail(configError("Ingest capture requires a positive width"));
  }
  if (!Number.isInteger(config.height) || config.height < 1) {
    return Effect.fail(configError("Ingest capture requires a positive height"));
  }
  if (!Number.isFinite(config.fps) || config.fps <= 0) {
    return Effect.fail(configError("Ingest capture requires a positive fps"));
  }
  const byteFormat = config.byteFormat ?? defaultConfig.byteFormat;
  if (byteFormat !== "rgba" && byteFormat !== "yuv420p") {
    return Effect.fail(configError('Ingest capture byteFormat must be "rgba" or "yuv420p"'));
  }
  const maxQueuedFrames = config.maxQueuedFrames ?? defaultConfig.maxQueuedFrames;
  if (!Number.isInteger(maxQueuedFrames) || maxQueuedFrames < 1) {
    return Effect.fail(configError("Ingest capture maxQueuedFrames must be a positive integer"));
  }
  return Effect.succeed({ port, path, width: config.width, height: config.height, fps: config.fps, byteFormat, maxQueuedFrames });
};

const frameBytes = (config: ResolvedIngestCaptureConfig): number =>
  config.byteFormat === "rgba"
    ? config.width * config.height * 4
    : Math.floor((config.width * config.height * 3) / 2);

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
                  sequence += 1;
                  // Synchronous boundary: Queue.unsafeOffer never suspends, so a full queue
                  // answers 429 HERE instead of hanging the POST. (Queue.offer would block
                  // until a take frees space — that parked every POST under load.) This is also
                  // the purity-compliant callback bridge: no Effect.run* in library code.
                  if (Queue.unsafeOffer(queue, frame)) {
                    stats.frameCount += 1;
                    res.writeHead(200, { "content-type": "application/json" }).end(
                      JSON.stringify({ seq: sequence - 1 })
                    );
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
        (srv) => Effect.promise(() => new Promise<void>((resolve) => srv.close(() => resolve())))
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
        frames: Stream.fromQueue(queue),
        health
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
