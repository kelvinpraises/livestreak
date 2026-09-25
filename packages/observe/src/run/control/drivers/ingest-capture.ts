import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type { ControlCallEnvelope } from "#run/control/bus/calls.js";
import type {
  BoardPatch,
  ControlFunctionContext,
  ControlFunctionEntry,
  ControlSurface
} from "#run/control/bus/types.js";
import {
  ingestCaptureCloseScope,
  ingestCaptureConfigureScope
} from "#pipeline/capture/ingest/commands.js";

/**
 * Ingest capture control surface — the bot's public configure path (B2-R02).
 *
 * A bot (or the console acting for it) configures the family capture cell with the frame
 * contract it will POST: dimensions + fps required, endpoint optional. The board carries the
 * contract; runConfigFromBoard derives the ingest driver from `settings.source === "ingest"`.
 * Cell id mirrors the catalog key so family calls (cellId obs:<id>:capture) fall back to this
 * surface, exactly like capture:file.
 */
export const createIngestCaptureControlSurface = (): ControlSurface => ({
  cell: {
    id: "capture:ingest",
    cell: {
      label: "Ingest Capture",
      catalog: "capture:ingest",
      status: ["idle", null, Date.now()],
      settings: {},
      readonly: { sourceType: "stream", sourceMode: "live", configured: false },
      functions: ["configure", "close"]
    }
  },
  functions: [configureEntry(), closeEntry()]
});

const configureEntry = (): ControlFunctionEntry => ({
  name: "configure",
  scope: ingestCaptureConfigureScope,
  call: (envelope, context) => configureCall(envelope, context)
});

const closeEntry = (): ControlFunctionEntry => ({
  name: "close",
  scope: ingestCaptureCloseScope,
  call: (_envelope, context) => closeCall(context)
});

interface IngestConfigureArgs {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly port?: number;
  readonly path?: string;
}

const configureCall = (
  envelope: ControlCallEnvelope,
  context: ControlFunctionContext
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    const args = yield* decodeConfigurePayload(envelope.payload);
    const nowMs = Date.now();

    return {
      boardPatch: {
        cells: {
          [context.cellId]: {
            settings: {
              set: {
                source: "ingest",
                width: args.width,
                height: args.height,
                fps: args.fps,
                ...(args.port === undefined ? {} : { port: args.port }),
                ...(args.path === undefined ? {} : { path: args.path })
              }
            },
            readonly: {
              set: { configured: true, sourceType: "stream", sourceMode: "live" }
            },
            status: ["configured", null, nowMs]
          }
        }
      }
    };
  });

const closeCall = (
  context: ControlFunctionContext
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.sync(() => {
    return {
      boardPatch: {
        cells: {
          [context.cellId]: {
            readonly: { set: { configured: false } },
            status: ["idle", null, Date.now()]
          }
        }
      }
    };
  });

const decodeConfigurePayload = (
  payload: unknown
): Effect.Effect<IngestConfigureArgs, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const fail = (message: string): Effect.Effect<never, LiveStreakConfigError> =>
      Effect.fail(
        new LiveStreakConfigError({ message: `${ingestCaptureConfigureScope} ${message}` })
      );
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return yield* fail("payload must be an object");
    }
    const record = payload as Record<string, unknown>;
    const width = record.width;
    const height = record.height;
    const fps = record.fps;
    if (!Number.isInteger(width) || (width as number) < 1) {
      return yield* fail("width must be a positive integer");
    }
    if (!Number.isInteger(height) || (height as number) < 1) {
      return yield* fail("height must be a positive integer");
    }
    if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0) {
      return yield* fail("fps must be a positive number");
    }
    const port = record.port;
    if (port !== undefined && (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535)) {
      return yield* fail("port must be an integer in 1..65535");
    }
    const path = record.path;
    if (path !== undefined && (typeof path !== "string" || !path.startsWith("/"))) {
      return yield* fail('path must start with "/"');
    }
    return {
      width: width as number,
      height: height as number,
      fps: fps as number,
      ...(port === undefined ? {} : { port: port as number }),
      ...(path === undefined ? {} : { path: path as string })
    };
  });
