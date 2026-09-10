import { Effect } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type { ControlCallEnvelope } from "#run/control/bus/index.js";
import type {
  BoardPatch,
  ControlFunctionContext,
  ControlFunctionEntry,
  ControlSurface
} from "#run/control/bus/index.js";
import type { ObserveRunResult } from "#run/kernel.js";
import type { ObserveRun } from "#run/run.js";
import type { ObserveRunHandle } from "#run/store.js";
import { setBoardRunPrepared, setBoardRunStatus } from "#run/control/board/model.js";

export const systemRunPrepareScope = "system:run:prepare" as const;
export const systemRunStartScope = "system:run:start" as const;
export const systemRunAwaitScope = "system:run:await" as const;
export const systemRunStopScope = "system:run:stop" as const;

export interface SystemRunHooks {
  readonly prepare?: (runId: string) => Effect.Effect<ObserveRun, LiveStreakError>;
  readonly start?: (runId: string) => Effect.Effect<ObserveRunHandle, LiveStreakError>;
  readonly await?: (runId: string) => Effect.Effect<ObserveRunResult, LiveStreakError>;
}

export const createSystemRunSurface = (hooks: SystemRunHooks = {}): ControlSurface => ({
  cell: {
    id: "system:run",
    cell: {
      label: "Run",
      catalog: "system:run",
      status: ["created", null, Date.now()],
      functions: ["prepare", "start", "await", "stop"]
    }
  },
  functions: [
    prepareFunctionEntry(hooks),
    startFunctionEntry(hooks),
    awaitFunctionEntry(hooks),
    stopFunctionEntry()
  ]
});

const prepareFunctionEntry = (hooks: SystemRunHooks): ControlFunctionEntry => ({
  name: "prepare",
  scope: systemRunPrepareScope,
  call: (_envelope, context) => prepareCall(context, hooks)
});

const startFunctionEntry = (hooks: SystemRunHooks): ControlFunctionEntry => ({
  name: "start",
  scope: systemRunStartScope,
  call: (_envelope, context) => startCall(context, hooks)
});

const awaitFunctionEntry = (hooks: SystemRunHooks): ControlFunctionEntry => ({
  name: "await",
  scope: systemRunAwaitScope,
  call: (_envelope, context) => awaitCall(context, hooks)
});

const stopFunctionEntry = (): ControlFunctionEntry => ({
  name: "stop",
  scope: systemRunStopScope,
  call: (envelope, context) => stopCall(envelope, context)
});

const prepareCall = (
  context: ControlFunctionContext,
  hooks: SystemRunHooks
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    if (hooks.prepare === undefined) {
      return yield* Effect.fail(
        new LiveStreakRuntimeError({ message: "system:run:prepare is not wired on this bus" })
      );
    }

    const runId = readRunId(context);
    yield* hooks.prepare(runId);

    const nowMs = Date.now();
    return {
      boardPatch: {
        cells: {
          "system:run": {
            readonly: { set: { prepared: true } },
            status: ["prepared", "observe run is ready to start", nowMs]
          }
        }
      }
    };
  });

const startCall = (
  context: ControlFunctionContext,
  hooks: SystemRunHooks
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    if (hooks.start === undefined) {
      return yield* Effect.fail(
        new LiveStreakRuntimeError({ message: "system:run:start is not wired on this bus" })
      );
    }

    const prepared = context.board.cells["system:run"]?.readonly?.prepared === true;
    if (!prepared) {
      return yield* Effect.fail(
        new LiveStreakConfigError({ message: "system:run:start requires a prepared run" })
      );
    }

    const runId = readRunId(context);
    yield* hooks.start(runId);

    const nowMs = Date.now();
    return {
      boardPatch: {
        cells: {
          "system:run": {
            status: ["starting", "starting observe run", nowMs]
          }
        }
      }
    };
  });

const awaitCall = (
  context: ControlFunctionContext,
  hooks: SystemRunHooks
): Effect.Effect<{ readonly boardPatch: BoardPatch }, LiveStreakError> =>
  Effect.gen(function* () {
    if (hooks.await === undefined) {
      return yield* Effect.fail(
        new LiveStreakRuntimeError({ message: "system:run:await is not wired on this bus" })
      );
    }

    const runId = readRunId(context);
    const result = yield* hooks.await(runId);
    const nowMs = Date.now();
    const terminalStatus = result.outcome === "stopped" ? "stopped" : "failed";

    return {
      boardPatch: {
        cells: {
          "system:run": {
            status: [terminalStatus, `outcome=${result.outcome}`, nowMs],
            readonly: {
              set: {
                outcome: result.outcome,
                ...(result.outputUri === undefined ? {} : { outputUri: result.outputUri })
              }
            }
          }
        }
      }
    };
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
      boardPatch: stopPatch(reason)
    };
  });

const stopPatch = (reason: string | undefined): BoardPatch => ({
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

const readRunId = (context: ControlFunctionContext): string => {
  const fromRun = context.board.cells["system:run"]?.readonly?.runId;
  if (typeof fromRun === "string" && fromRun.length > 0) {
    return fromRun;
  }

  const fromConfig = context.board.cells["system:config"]?.readonly?.runId;
  return typeof fromConfig === "string" ? fromConfig : "";
};

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

export const systemRunCatalogFunctions = (): Readonly<
  Record<
    string,
    {
      readonly scope: string;
      readonly label: string;
      readonly description: string;
      readonly result: "patch";
      readonly input?: import("#run/control/catalog.js").JsonSchema;
    }
  >
> => ({
  prepare: {
    scope: systemRunPrepareScope,
    label: "Prepare",
    description: "Validate board settings and mark the run ready to start.",
    result: "patch"
  },
  start: {
    scope: systemRunStartScope,
    label: "Start",
    description: "Start the observe worker for a prepared run.",
    result: "patch"
  },
  await: {
    scope: systemRunAwaitScope,
    label: "Await",
    description: "Wait for the active run to finish and record the outcome on the board.",
    result: "patch"
  },
  stop: {
    scope: systemRunStopScope,
    label: "Stop",
    description: "Request a clean worker stop and sink finalize.",
    result: "patch",
    input: {
      type: "object",
      properties: [
        {
          name: "reason",
          value: { type: "string", description: "Optional stop reason." },
          help: "Human-readable reason recorded on the run cell."
        }
      ]
    }
  }
});

/** Apply prepare status transitions used by the legacy kernel prepare path. */
export const boardPatchesForPrepare = (
  board: import("#run/control/board/model.js").Board,
  message: string
): import("#run/control/board/model.js").Board => {
  let next = setBoardRunStatus(board, "preparing", message);
  next = setBoardRunStatus(next, "prepared", "observe run is ready to start");
  return setBoardRunPrepared(next, true);
};
