import { Effect, Scope } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import type { PackageRuntimeInit } from "@livestreak/schema";
import type { ControlCallEnvelope, ControlCallResult, ControlArtifact } from "./control/bus/index.js";
import type {
  ArtifactSubscription,
  BoardSubscription,
  ControlPanel
} from "./control/bus/index.js";
import type { Board } from "./control/board/index.js";
import {
  prepareObserveRun,
  startObserveRunAsync,
  stopObserveRun,
  type ObserveRunKernelOptions,
  type ObserveRunResult,
  type StopRunOptions
} from "./kernel.js";
import { makeObserveRun, type ObserveRun, type ObserveRunConfig } from "./run.js";
import { runConfigFromBoard } from "./board-run-config.js";
import { observationCellId, readObservationIndex } from "./control/system/config.js";
import { createLiveSinkDriver } from "#pipeline/publish/sinks/live/driver.js";
import { createDirectSinkDriver } from "#pipeline/publish/sinks/direct/driver.js";
import {
  callStoredRunFunction,
  createRunStore,
  getStoredRunArtifact,
  readStoredRunBoard,
  readStoredRunPanel,
  reclaimTerminalRunHandle,
  subscribeStoredRunArtifacts,
  subscribeStoredRunBoard,
  type ObserveRunHandle,
  type RunStore
} from "./store.js";

type LiveSinkDriver = ReturnType<typeof createLiveSinkDriver>;
type DirectSinkDriver = ReturnType<typeof createDirectSinkDriver>;

export type { StopRunOptions } from "./kernel.js";
export { defaultStopTimeoutMs } from "./kernel.js";

export type RuntimeKernelOptions = ObserveRunKernelOptions & { readonly maxTurns?: number };

export interface CreateObserveRuntimeInput {
  readonly store?: RunStore;
  readonly defaultKernelOptions?: RuntimeKernelOptions;
  readonly sessionInit?: PackageRuntimeInit;
}

export interface ObserveRuntime {
  readonly store: RunStore;

  readonly prepareRun: (
    config: ObserveRunConfig,
    options?: ObserveRunKernelOptions
  ) => Effect.Effect<ObserveRun, LiveStreakError>;

  /**
   * Prepare the run from its CONSOLE-configured board: derive the run config (capture/sink/market) from the
   * board, wiring the encode-once fMP4 `live` sink (its host ingest transport is built by
   * runConfigFromBoard). The caller passes only the host base URL it owns; observe owns the board→config
   * mapping and the sink wiring. Prepares in place so the board's market registration / live state survives.
   */
  readonly prepareConfiguredRun: (
    runId: string,
    options: { readonly hostBaseUrl: string; readonly obsId?: string }
  ) => Effect.Effect<ObserveRun, LiveStreakError>;

  readonly startRun: (
    runId: string,
    options?: RuntimeKernelOptions,
    obsId?: string
  ) => Effect.Effect<ObserveRunHandle, LiveStreakError>;

  readonly listRuns: () => Effect.Effect<readonly ObserveRun[]>;
  readonly listHandles: () => Effect.Effect<readonly ObserveRunHandle[]>;

  readonly readBoard: (runId: string) => Effect.Effect<Board, LiveStreakError>;

  readonly readPanel: (
    runId: string,
    options?: { readonly includeCatalog?: boolean }
  ) => Effect.Effect<ControlPanel, LiveStreakError>;

  readonly callFunction: (
    envelope: ControlCallEnvelope
  ) => Effect.Effect<ControlCallResult, LiveStreakError>;

  readonly getArtifact: (
    runId: string,
    artifactId: unknown
  ) => Effect.Effect<ControlArtifact, LiveStreakError>;

  readonly subscribeBoard: (
    runId: string,
    listener: (board: Board) => void
  ) => Effect.Effect<BoardSubscription, LiveStreakError>;

  readonly subscribeArtifacts: (
    runId: string,
    listener: (artifact: ControlArtifact) => void
  ) => Effect.Effect<ArtifactSubscription, LiveStreakError>;

  readonly awaitRun: (runId: string, obsId?: string) => Effect.Effect<ObserveRunResult, LiveStreakError>;

  readonly stopRun: (
    runId: string,
    options?: StopRunOptions,
    obsId?: string
  ) => Effect.Effect<ObserveRunResult, LiveStreakError>;

  readonly removeRun: (runId: string) => Effect.Effect<void>;
  readonly removeHandle: (runId: string) => Effect.Effect<void>;
}

/** Per-observation run/handle addressing: the base bus entry lives at runId; each observation's
 *  prepared run and worker handle live at runId#obsId. Legacy single-run flows keep the bare key. */
const runKey = (runId: string, obsId?: string): string =>
  obsId === undefined ? runId : `${runId}#${obsId}`;

const mergeKernelOptions = (
  defaults: RuntimeKernelOptions | undefined,
  overrides: RuntimeKernelOptions | undefined
): RuntimeKernelOptions => ({ ...defaults, ...overrides });

const buildObserveRuntime = (
  input: CreateObserveRuntimeInput,
  scope: Scope.Scope
): ObserveRuntime => {
  const store = input.store ?? createRunStore();
  const defaultKernelOptions = input.defaultKernelOptions;
  const sessionInit = input.sessionInit;

  // The encode-once streaming sink drivers — built once, reused for prepare + start. Their per-run state
  // (ingest transport / viewer server) rides on the run config or attach, so the drivers are stateless here.
  let cachedLiveSink: LiveSinkDriver | undefined;
  let cachedDirectSink: DirectSinkDriver | undefined;
  const streamingSinkFor = (driverId: string): LiveSinkDriver | DirectSinkDriver | undefined => {
    if (driverId === "live") {
      cachedLiveSink ??= createLiveSinkDriver();
      return cachedLiveSink;
    }
    if (driverId === "direct") {
      cachedDirectSink ??= createDirectSinkDriver();
      return cachedDirectSink;
    }
    return undefined;
  };

  const runHooks: import("./control/system/run.js").SystemRunHooks = {
    prepare: (runId: string, obsId?: string) =>
      Effect.gen(function* () {
        const key = runKey(runId, obsId);
        const existing = yield* store.get(key);
        const run = existing ?? (yield* store.require(runId));
        if (run.prepared === true && run.bus !== undefined) {
          return run;
        }
        const prepared = yield* prepareObserveRun(
          run,
          mergeKernelOptions(defaultKernelOptions, { sessionInit, runHooks })
        );
        yield* store.replace(prepared, key);
        return prepared;
      }),
    start: (runId: string, obsId?: string) =>
      startRunEffect(
        store,
        scope,
        runKey(runId, obsId),
        mergeKernelOptions(defaultKernelOptions, { sessionInit, runHooks })
      ),
    await: (runId: string, obsId?: string) =>
      Effect.gen(function* () {
        const handle = yield* store.requireHandle(runKey(runId, obsId));
        return yield* handle.awaitResult();
      })
  };

  return {
    store,

    prepareRun: (config, options) =>
      Effect.gen(function* () {
        const run = yield* makeObserveRun(config);
        const prepared = yield* prepareObserveRun(
          run,
          mergeKernelOptions(defaultKernelOptions, { ...options, sessionInit, runHooks })
        );
        yield* store.put(prepared);
        return prepared;
      }),

    prepareConfiguredRun: (runId, options) =>
      Effect.gen(function* () {
        const run = yield* store.require(runId);
        // Resolve WHICH observation this prepare drives: the caller's, or the session's only one.
        const boardForObs = yield* readStoredRunBoard(store, runId);
        const index = readObservationIndex(boardForObs);
        const obsId =
          options.obsId ?? (Object.keys(index).length === 1 ? Object.keys(index)[0] : undefined);
        const key = runKey(runId, obsId);
        // Re-preparing a finished run reclaims its terminal handle (so reads route to the fresh bus,
        // not the dead run's); an ACTIVE run of THIS observation refuses re-prepare. Other
        // observations' runs are untouched — that is the whole point of the key.
        yield* reclaimTerminalRunHandle(store, key);
        // Prepare composes registration: an unregistered family market registers here, with the
        // title saved at birth. Idempotent by board state — a registered market is skipped.
        {
          const marketCell =
            obsId === undefined ? undefined : boardForObs.cells[observationCellId(obsId, "market")];
          if (
            obsId !== undefined &&
            marketCell !== undefined &&
            marketCell.readonly?.registrationState === "none"
          ) {
            yield* callStoredRunFunction(store, {
              callId: `prepare-register-${runId}-${obsId}`,
              runId,
              cellId: observationCellId(obsId, "market"),
              scope: "market:register",
              payload: {}
            });
          }
        }
        // Config derives from the BUS board (canonical) — the stored run's board copy can lag
        // behind configure calls that haven't been synced back yet.
        const config = yield* runConfigFromBoard({
          runId,
          board: yield* readStoredRunBoard(store, runId),
          hostBaseUrl: options.hostBaseUrl,
          ...(obsId === undefined ? {} : { obsId })
        });
        const sinkDriver = streamingSinkFor(config.sink.driverId);
        const prepared = yield* prepareObserveRun(
          { ...run, config, manifest: run.manifest, prepared: false },
          mergeKernelOptions(defaultKernelOptions, {
            ...(sinkDriver === undefined ? {} : { sinkDriver }),
            sessionInit,
            runHooks
          })
        );
        yield* store.replace(prepared, key);
        return prepared;
      }),

    startRun: (runId, options, obsId) =>
      Effect.gen(function* () {
        // Re-supply the injected streaming sink for a board-configured run (the kernel re-resolves the
        // driver at start). For every other sink, leave sinkDriver unset — writing an `undefined` key into
        // the overrides would clobber defaultKernelOptions.sinkDriver, so the kernel fails to resolve the
        // driver (e.g. the in-memory test sink) and the worker hangs.
        const key = runKey(runId, obsId);
        const run = yield* store.get(key).pipe(
          Effect.flatMap((entry) => (entry !== undefined ? Effect.succeed(entry) : store.require(runId)))
        );
        const streamingSink = streamingSinkFor(run.config.sink.driverId);
        return yield* startRunEffect(
          store,
          scope,
          key,
          mergeKernelOptions(defaultKernelOptions, {
            ...options,
            ...(streamingSink === undefined ? {} : { sinkDriver: streamingSink }),
            sessionInit,
            runHooks
          })
        );
      }),

    listRuns: () => store.list(),
    listHandles: () => store.listHandles(),

    readBoard: (runId) => readStoredRunBoard(store, runId),

    readPanel: (runId, options) => readStoredRunPanel(store, runId, options),

    callFunction: (envelope) => callStoredRunFunction(store, envelope),

    getArtifact: (runId, artifactId) => getStoredRunArtifact(store, runId, artifactId),

    subscribeBoard: (runId, listener) => subscribeStoredRunBoard(store, runId, listener),

    subscribeArtifacts: (runId, listener) => subscribeStoredRunArtifacts(store, runId, listener),

    awaitRun: (runId, obsId) =>
      Effect.gen(function* () {
        const handle = yield* store.requireHandle(runKey(runId, obsId));
        return yield* handle.awaitResult();
      }),

    stopRun: (runId, options, obsId) => stopObserveRun(store, runId, options, obsId),

    removeRun: (runId) => store.remove(runId),
    removeHandle: (runId) => store.removeHandle(runId)
  };
};

const startRunEffect = (
  store: RunStore,
  scope: Scope.Scope,
  key: string,
  options: RuntimeKernelOptions
) =>
  Effect.gen(function* () {
    yield* reclaimTerminalRunHandle(store, key);
    const run = yield* store.require(key);
    const handle = yield* startObserveRunAsync({
      run,
      options
    }).pipe(Effect.provideService(Scope.Scope, scope));
    yield* store.putHandle(handle, key);
    return handle;
  });

export const createObserveRuntime = (
  input: CreateObserveRuntimeInput = {}
): Effect.Effect<ObserveRuntime, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    return buildObserveRuntime(input, scope);
  });
