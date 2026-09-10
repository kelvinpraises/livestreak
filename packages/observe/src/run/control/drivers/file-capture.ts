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
  fileCaptureCloseScope,
  fileCaptureConfigureScope
} from "#pipeline/capture/file/commands.js";

const FILE_CAPTURE_CONFIGURATOR_ID = "observe.capture.file";

export const createFileCaptureControlSurface = (): ControlSurface => ({
  cell: {
    id: "capture:file",
    cell: {
      label: "File Capture",
      catalog: "capture:file",
      status: ["idle", null, Date.now()],
      settings: { maxPumpMs: 4 },
      readonly: { sourceType: "file", sourceMode: "file", configured: false },
      functions: ["configure", "close"]
    }
  },
  functions: [configureEntry(), closeEntry()]
});

const configureEntry = (): ControlFunctionEntry => ({
  name: "configure",
  scope: fileCaptureConfigureScope,
  call: (envelope, context) => configureCall(envelope, context)
});

const closeEntry = (): ControlFunctionEntry => ({
  name: "close",
  scope: fileCaptureCloseScope,
  call: (_envelope, context) => closeCall(context)
});

const configureCall = (
  envelope: ControlCallEnvelope,
  context: ControlFunctionContext
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    const path = yield* decodePathPayload(envelope.payload, "capture:file:configure");
    const nowMs = Date.now();

    return {
      boardPatch: {
        cells: {
          "capture:file": {
            settings: { set: { path, maxPumpMs: 4 } },
            readonly: { set: { configured: true, sourceType: "file", sourceMode: "file" } },
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
    const live = readLiveConfigurators(context.board).filter(
      (id) => id !== FILE_CAPTURE_CONFIGURATOR_ID
    );

    return {
      boardPatch: {
        cells: {
          "capture:file": { remove: true },
          "system:config": {
            readonly: { set: { liveConfigurators: live } }
          }
        }
      }
    };
  });

const decodePathPayload = (
  payload: unknown,
  scope: string
): Effect.Effect<string, LiveStreakConfigError> =>
  Effect.gen(function* () {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: `${scope} payload must be an object` })
      );
    }

    const path = (payload as Record<string, unknown>).path;
    if (typeof path !== "string" || path.trim().length === 0) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: `${scope} path must be a non-empty string` })
      );
    }

    return path.trim();
  });
