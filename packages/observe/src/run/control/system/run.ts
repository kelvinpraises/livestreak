import { Effect } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type { ControlCallEnvelope } from "#run/control/bus/index.js";
import type {
  BoardPatch,
  ControlFunctionContext,
  ControlFunctionEntry,
  ControlSurface
} from "#run/control/bus/index.js";

export const systemRunStopScope = "system:run:stop" as const;

export const createSystemRunSurface = (): ControlSurface => ({
  cell: {
    id: "system:run",
    cell: {
      label: "Run",
      catalog: "system:run",
      // eslint-disable-next-line unicorn/no-null -- BoardCell.status tuple uses null for absent message
      status: ["created", null, Date.now()],
      functions: ["stop"]
    }
  },
  functions: [stopFunctionEntry()]
});

const stopFunctionEntry = (): ControlFunctionEntry => ({
  name: "stop",
  scope: systemRunStopScope,
  call: (envelope, context) => stopCall(envelope, context)
});

const stopCall = (
  envelope: ControlCallEnvelope,
  context: ControlFunctionContext
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    const reason = yield* decodeStopPayload(envelope.payload);
    const runCell = context.board.cells["system:run"];
    const settings = runCell?.settings ?? {};

    if (settings.stopRequested === true) {
      return { boardPatch: {} };
    }

    return {
      boardPatch: stopPatch(envelope, reason)
    };
  });

const stopPatch = (_envelope: ControlCallEnvelope, reason: string | undefined): BoardPatch => ({
  cells: {
    "system:run": {
      settings: {
        set: {
          stopRequested: true,
          ...(reason === undefined ? {} : { stopReason: reason })
        }
      }
    }
  }
});

const decodeStopPayload = (
  payload: unknown
): Effect.Effect<string | undefined, LiveStreakConfigError> =>
  Effect.gen(function* () {
    if (payload === undefined) {
      return;
    }

    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "system:run:stop payload must be an object"
        })
      );
    }

    const record = payload as Record<string, unknown>;
    const keys = Object.keys(record);

    if (keys.length === 0) {
      return;
    }

    for (const key of keys) {
      if (key !== "reason") {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: `system:run:stop payload has unknown property ${key}`
          })
        );
      }
    }

    if (record.reason === undefined) {
      return;
    }

    if (typeof record.reason !== "string") {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "system:run:stop reason must be a string"
        })
      );
    }

    const trimmed = record.reason.trim();
    if (trimmed.length === 0) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "system:run:stop reason must be a non-empty string when provided"
        })
      );
    }

    return trimmed;
  });
