import { Effect } from "effect";
import {
  LiveStreakCapabilityError,
  LiveStreakConfigError,
  type LiveStreakError
} from "@livestreak/core";
import { projectControlPanelControls } from "#bridge/panel/project.js";
import { descriptorId } from "#bridge/panel/descriptors.js";
import { buildControlCatalog } from "#run/control/catalog.js";
import {
  systemConfigConfigureScope,
  systemRunPrepareScope,
  systemRunStartScope,
  systemRunStopScope
} from "#run/control/index.js";
import { type SystemConfigConfigurePayload } from "#run/board-first.js";
import { observationIdOf } from "#run/control/system/config.js";
import { readBoardRunPrepared } from "#run/control/board/index.js";
import { hasAnyScope, requireAnyScope, type CapabilityScope } from "#scope/scopes.js";
import type {
  BridgeCaller,
  BridgeCallInput,
  BridgeConsoleCallInput,
  BridgeConsoleCallResult,
  CreateObserveBridgeInput,
  ObserveBridge
} from "./types.js";
import {
  bridgeArtifactReadScope,
  bridgeArtifactSubscribeScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope,
  bridgeRunAwaitScope
} from "./types.js";

export type {
  BridgeArtifactInput,
  BridgeCallInput,
  BridgeCaller,
  BridgeRunInput,
  BridgeSubscribeArtifactsInput,
  BridgeSubscribeBoardInput,
  BridgeStopRunInput,
  CreateObserveBridgeInput,
  ObserveBridge
} from "./types.js";

export {
  bridgeArtifactReadScope,
  bridgeArtifactSubscribeScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope,
  bridgeRunAwaitScope
} from "./types.js";

export const evaluateBridgeAuthorization = (
  caller: BridgeCaller,
  requiredScope: string
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    yield* validateBridgeCaller(caller);
    yield* validateBridgeScope(requiredScope);

    if (caller.trusted === true) {
      return;
    }

    yield* requireAnyScope(caller.grants ?? [], requiredScope as CapabilityScope);
  });

// Cell-qualified id → internal scope (unique); bare action name → internal scope (last-write wins
// across cells, legacy fallback only). The catalog is static, so build once.
const consoleScopeIndex = (): {
  readonly byId: ReadonlyMap<string, string>;
  readonly byAction: ReadonlyMap<string, string>;
} => {
  const catalog = buildControlCatalog();
  const byId = new Map<string, string>();
  const byAction = new Map<string, string>();
  for (const [cellId, cell] of Object.entries(catalog.cells)) {
    for (const [name, fn] of Object.entries(cell.functions)) {
      byId.set(descriptorId(cellId, name), fn.scope);
      byAction.set(name, fn.scope);
    }
  }
  return { byId, byAction };
};

const CONSOLE_SCOPES = consoleScopeIndex();

/** observe.<cell segments…>.<fn> → { cellId: segments joined by ':', fn }. */
const parseConsoleId = (id: string): { cellId: string; fn: string } | undefined => {
  const parts = id.split(".");
  if (parts.length < 3 || parts[0] !== "observe") {
    return undefined;
  }
  return { cellId: parts.slice(1, -1).join(":"), fn: parts[parts.length - 1]! };
};

export const createObserveBridge = (input: CreateObserveBridgeInput): ObserveBridge => {
  const { runtime } = input;

  // Dual-accept: the internal observe scope (local/package grants) OR the unified console scope a
  // remote session grant carries. Trusted operators short-circuit.
  const authorizeConsole = (
    caller: BridgeCaller,
    internalScope: string,
    action: string
  ): Effect.Effect<void, LiveStreakError> =>
    Effect.gen(function* () {
      yield* validateBridgeCaller(caller);
      if (caller.trusted === true) {
        return;
      }
      const grants = caller.grants ?? [];
      const consoleScope = `bridge:action:${action}` as CapabilityScope;
      if (
        hasAnyScope(grants, internalScope as CapabilityScope) ||
        hasAnyScope(grants, consoleScope)
      ) {
        return;
      }
      yield* Effect.fail(
        new LiveStreakCapabilityError({
          message: `No capability grant authorizes ${internalScope} or ${consoleScope}`,
          requiredScope: internalScope
        })
      );
    });

  const callConsoleAction = (
    consoleInput: BridgeConsoleCallInput
  ): Effect.Effect<BridgeConsoleCallResult, LiveStreakError> =>
    Effect.gen(function* () {
      // Family routing: a descriptor id names its CELL (observe.obs.<id>.run.prepare →
      // obs:<id>:run); the scope comes from that cell's live catalog binding. Unknown cells
      // fail closed — a call can never fall through to another family.
      const parsed = consoleInput.id === undefined ? undefined : parseConsoleId(consoleInput.id);
      const liveBoard = yield* runtime.readBoard(consoleInput.runId);
      let cellId: string | undefined;
      let internalScope: string | undefined;
      if (parsed !== undefined) {
        const cell = liveBoard.cells[parsed.cellId];
        if (cell === undefined) {
          return yield* Effect.fail(
            new LiveStreakConfigError({
              message: `Unknown observe cell for "${consoleInput.id}"`
            })
          );
        }
        cellId = parsed.cellId;
        internalScope = `${cell.catalog ?? parsed.cellId}:${parsed.fn}`;
      } else {
        internalScope =
          consoleInput.action === "configure"
            ? systemConfigConfigureScope
            : CONSOLE_SCOPES.byAction.get(consoleInput.action);
      }
      if (internalScope === undefined) {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: `Unknown observe action "${consoleInput.id ?? consoleInput.action}"`
          })
        );
      }
      yield* authorizeConsole(consoleInput.caller, internalScope, consoleInput.action);
      const obsId = cellId === undefined ? undefined : observationIdOf(cellId);

      // Run-execution lifecycle drives the kernel directly (the board-first T0 bus only wires
      // config + market lifecycle); prepare/start build & run the producer from the configured board.
      if (internalScope === systemRunPrepareScope) {
        if (input.hostBaseUrl === undefined) {
          return yield* Effect.fail(
            new LiveStreakConfigError({
              message: "Observe bridge run prepare requires hostBaseUrl at bridge creation"
            })
          );
        }
        yield* runtime.prepareConfiguredRun(consoleInput.runId, {
          hostBaseUrl: input.hostBaseUrl,
          ...(obsId === undefined ? {} : { obsId })
        });
        return { txId: `prepare-${consoleInput.runId}` };
      }
      if (internalScope === systemRunStartScope) {
        // Prepared is a disposable derivation of the board (a pipeline config change demotes
        // it) — start re-derives it instead of failing "must be prepared" at the operator.
        // Per-observation runs live at runId#obsId (the runtime's key scheme).
        const preparedKey =
          obsId === undefined ? consoleInput.runId : `${consoleInput.runId}#${obsId}`;
        const run =
          (yield* runtime.store.get(preparedKey)) ??
          (yield* runtime.store.require(consoleInput.runId));
        if (run.prepared !== true) {
          if (input.hostBaseUrl === undefined) {
            return yield* Effect.fail(
              new LiveStreakConfigError({
                message: "Observe bridge run start requires hostBaseUrl at bridge creation"
              })
            );
          }
          yield* runtime.prepareConfiguredRun(consoleInput.runId, {
            hostBaseUrl: input.hostBaseUrl,
            ...(obsId === undefined ? {} : { obsId })
          });
        }
        yield* runtime.startRun(consoleInput.runId, undefined, obsId);
        return { txId: `start-${preparedKey}` };
      }
      if (internalScope === systemRunStopScope) {
        const reason = readStopReason(consoleInput.args);
        yield* runtime.stopRun(
          consoleInput.runId,
          reason === undefined ? undefined : { reason },
          obsId
        );
        return { txId: `stop-${consoleInput.runId}` };
      }

      const payload =
        internalScope === systemConfigConfigureScope
          ? coerceConfigurePayload(consoleInput.args, input.sessionInit?.chain)
          : consoleInput.args;
      const result = yield* runtime.callFunction({
        callId: `remote-${Date.now()}`,
        runId: consoleInput.runId,
        ...(cellId === undefined ? {} : { cellId }),
        scope: internalScope,
        payload
      });

      // Keep the stored run's board in sync so later store reads see the post-call state —
      // including the prepared flag, which the board patch layer demotes on config changes.
      const run = yield* runtime.store.require(consoleInput.runId);
      const board = yield* runtime.readBoard(consoleInput.runId);
      yield* runtime.store.replace({
        ...run,
        board,
        prepared: readBoardRunPrepared(board) ?? run.prepared
      });

      return {
        txId: result.callId,
        ...(result.artifactId === undefined ? {} : { tokenId: String(result.artifactId) })
      };
    });

  return {
    runtime,

    callConsoleAction,

    readBoard: (bridgeInput) =>
      Effect.gen(function* () {
        yield* evaluateBridgeAuthorization(bridgeInput.caller, bridgeBoardReadScope);
        return yield* runtime.readBoard(bridgeInput.runId);
      }),

    readControls: (bridgeInput) =>
      Effect.gen(function* () {
        yield* evaluateBridgeAuthorization(bridgeInput.caller, bridgeControlsReadScope);
        const panel = yield* runtime.readPanel(bridgeInput.runId, { includeCatalog: true });
        return projectControlPanelControls(panel);
      }),

    callFunction: (bridgeInput) =>
      Effect.gen(function* () {
        yield* validateBridgeCallInput(bridgeInput);
        yield* evaluateBridgeAuthorization(bridgeInput.caller, bridgeInput.envelope.scope);
        return yield* runtime.callFunction(bridgeInput.envelope);
      }),

    getArtifact: (bridgeInput) =>
      Effect.gen(function* () {
        yield* evaluateBridgeAuthorization(bridgeInput.caller, bridgeArtifactReadScope);
        return yield* runtime.getArtifact(bridgeInput.runId, bridgeInput.artifactId);
      }),

    subscribeBoard: (bridgeInput) =>
      Effect.gen(function* () {
        yield* evaluateBridgeAuthorization(bridgeInput.caller, bridgeBoardSubscribeScope);
        return yield* runtime.subscribeBoard(bridgeInput.runId, bridgeInput.listener);
      }),

    subscribeArtifacts: (bridgeInput) =>
      Effect.gen(function* () {
        yield* evaluateBridgeAuthorization(bridgeInput.caller, bridgeArtifactSubscribeScope);
        return yield* runtime.subscribeArtifacts(bridgeInput.runId, bridgeInput.listener);
      }),

    awaitRun: (bridgeInput) =>
      Effect.gen(function* () {
        yield* evaluateBridgeAuthorization(bridgeInput.caller, bridgeRunAwaitScope);
        return yield* runtime.awaitRun(bridgeInput.runId);
      }),

    stopRun: (bridgeInput) =>
      Effect.gen(function* () {
        yield* validateBridgeCaller(bridgeInput.caller);
        yield* evaluateBridgeAuthorization(bridgeInput.caller, systemRunStopScope);
        return yield* runtime.stopRun(bridgeInput.runId, {
          ...(bridgeInput.reason === undefined ? {} : { reason: bridgeInput.reason }),
          ...(bridgeInput.timeoutMs === undefined ? {} : { timeoutMs: bridgeInput.timeoutMs })
        });
      })
  };
};

const validateBridgeCaller = (
  caller: BridgeCaller
): Effect.Effect<void, LiveStreakConfigError> => {
  if (caller.id.trim().length === 0) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "Bridge caller id is required"
      })
    );
  }

  return Effect.void;
};

const validateBridgeScope = (
  requiredScope: string
): Effect.Effect<void, LiveStreakConfigError> => {
  if (requiredScope.trim().length === 0) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "Bridge authorization scope is required"
      })
    );
  }

  return Effect.void;
};

const validateBridgeCallInput = (
  bridgeInput: BridgeCallInput
): Effect.Effect<void, LiveStreakConfigError> =>
  Effect.gen(function* () {
    yield* validateBridgeCaller(bridgeInput.caller);

    if (bridgeInput.envelope.scope.trim().length === 0) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "Control call envelope scope is required"
        })
      );
    }
  });

const readStopReason = (args: unknown): string | undefined =>
  typeof args === "object" && args !== null && typeof (args as { reason?: unknown }).reason === "string"
    ? (args as { reason: string }).reason
    : undefined;

// The console may send a partial configure; fall back to the session defaults rather than
// rejecting a pristine go-live. Configure = create observation: title + chain only.
const coerceConfigurePayload = (
  args: unknown,
  chain: string | undefined
): SystemConfigConfigurePayload => {
  const record =
    typeof args === "object" && args !== null && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  return {
    title: typeof record.title === "string" && record.title.trim() !== "" ? record.title : "Observation",
    chain: typeof record.chain === "string" && record.chain.trim() !== "" ? record.chain : (chain ?? "eip155:31337")
  };
};
