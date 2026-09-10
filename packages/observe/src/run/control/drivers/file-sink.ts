import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type { ControlCallEnvelope } from "#run/control/bus/calls.js";
import type {
  BoardPatch,
  ControlFunctionContext,
  ControlFunctionEntry,
  ControlSurface
} from "#run/control/bus/types.js";
import { readLiveConfigurators } from "#run/control/board/visibility.js";
import {
  fileSinkCloseScope,
  fileSinkConfigureScope
} from "#pipeline/publish/sinks/file/commands.js";

export const createFileSinkControlSurface = (
  instanceId = "file-export"
): ControlSurface => ({
  cell: {
    id: `sink:${instanceId}`,
    cell: {
      label: "File Export",
      catalog: "sink:file",
      status: ["idle", null, Date.now()],
      settings: { subscribe: ["publish.video.rendered"], required: true },
      readonly: { configured: false },
      functions: ["configure", "close"]
    }
  },
  functions: [configureEntry(instanceId), closeEntry(instanceId)]
});

const configureEntry = (instanceId: string): ControlFunctionEntry => ({
  name: "configure",
  scope: fileSinkConfigureScope,
  call: (envelope, context) => configureCall(envelope, context, instanceId)
});

const closeEntry = (instanceId: string): ControlFunctionEntry => ({
  name: "close",
  scope: fileSinkCloseScope,
  call: (_envelope, context) => closeCall(context, instanceId)
});

const configureCall = (
  envelope: ControlCallEnvelope,
  _context: ControlFunctionContext,
  instanceId: string
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    const path = yield* decodePathPayload(envelope.payload);
    const nowMs = Date.now();
    const cellId = `sink:${instanceId}`;

    return {
      boardPatch: {
        cells: {
          [cellId]: {
            settings: {
              set: { path, subscribe: ["publish.video.rendered"], required: true }
            },
            readonly: { set: { configured: true } },
            status: ["configured", null, nowMs]
          }
        }
      }
    };
  });

const closeCall = (
  context: ControlFunctionContext,
  instanceId: string
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.sync(() => {
    const live = readLiveConfigurators(context.board).filter(
      (id) => id !== `observe.sink.${instanceId}`
    );

    return {
      boardPatch: {
        cells: {
          [`sink:${instanceId}`]: { remove: true },
          "system:config": {
            readonly: { set: { liveConfigurators: live } }
          }
        }
      }
    };
  });

const decodePathPayload = (payload: unknown): Effect.Effect<string, LiveStreakConfigError> =>
  Effect.gen(function* () {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "sink:file-export:configure payload must be an object" })
      );
    }

    const path = (payload as Record<string, unknown>).path;
    if (typeof path !== "string" || path.trim().length === 0) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "sink:file-export:configure path must be a non-empty string"
        })
      );
    }

    return path.trim();
  });
