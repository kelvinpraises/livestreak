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
import { createLocalSinkDriver } from "#pipeline/publish/sinks/local/driver.js";
import {
  fetchHostIceConfig,
  resolveNodePeerConnectionFactory,
  type NodeIceConfig
} from "#pipeline/publish/sinks/local/node-peer.js";
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

type LocalSinkDriver = ReturnType<typeof createLocalSinkDriver>;

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
   * Prepare the run from its CONSOLE-configured board: derive the run config (capture/sink/market) from
   * the board and, for the local WebRTC sink, wire the Node peer factory + host signaling. The caller
   * passes only the host base URL it owns; observe owns the board→config mapping and the sink wiring.
   * Prepares in place so the board's market registration / live state survives.
   */
  readonly prepareConfiguredRun: (
    runId: string,
    options: { readonly hostBaseUrl: string }
  ) => Effect.Effect<ObserveRun, LiveStreakError>;

  readonly startRun: (
    runId: string,
    options?: RuntimeKernelOptions
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

  readonly awaitRun: (runId: string) => Effect.Effect<ObserveRunResult, LiveStreakError>;

  readonly stopRun: (
    runId: string,
    options?: StopRunOptions
  ) => Effect.Effect<ObserveRunResult, LiveStreakError>;

  readonly removeRun: (runId: string) => Effect.Effect<void>;
  readonly removeHandle: (runId: string) => Effect.Effect<void>;
}

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

  // The Node WebRTC sink driver (peer factory via @roamhq/wrtc) — built once, reused for prepare + start.
  let cachedLocalSink: LocalSinkDriver | undefined;
  const ensureLocalSink = (
    iceConfig?: NodeIceConfig
  ): Effect.Effect<LocalSinkDriver, LiveStreakError> =>
    Effect.gen(function* () {
      if (cachedLocalSink === undefined) {
        const peerConnectionFactory = yield* resolveNodePeerConnectionFactory(iceConfig);
        cachedLocalSink = createLocalSinkDriver({ peerConnectionFactory });
      }
      return cachedLocalSink;
    });

  const runHooks: import("./control/system/run.js").SystemRunHooks = {
    prepare: (runId: string) =>
      Effect.gen(function* () {
        const run = yield* store.require(runId);
        if (run.prepared === true && run.bus !== undefined) {
          return run;
        }
        const prepared = yield* prepareObserveRun(
          run,
          mergeKernelOptions(defaultKernelOptions, { sessionInit, runHooks })
        );
        yield* store.replace(prepared);
        return prepared;
      }),
    start: (runId: string) =>
      startRunEffect(store, scope, runId, mergeKernelOptions(defaultKernelOptions, { sessionInit, runHooks })),
    await: (runId: string) =>
      Effect.gen(function* () {
        const handle = yield* store.requireHandle(runId);
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
        // Re-preparing a finished run reclaims its terminal handle (so reads route to the fresh bus,
        // not the dead run's); an ACTIVE run refuses re-prepare.
        yield* reclaimTerminalRunHandle(store, runId);
        const config = yield* runConfigFromBoard({
          runId,
          board: run.board,
          hostBaseUrl: options.hostBaseUrl
        });
        const iceConfig = yield* fetchHostIceConfig(options.hostBaseUrl);
        const sinkDriver = yield* ensureLocalSink(iceConfig);
        const prepared = yield* prepareObserveRun(
          { ...run, config, manifest: run.manifest, prepared: false },
          mergeKernelOptions(defaultKernelOptions, { sinkDriver, sessionInit, runHooks })
        );
        yield* store.replace(prepared);
        return prepared;
      }),

    startRun: (runId, options) =>
      Effect.gen(function* () {
        // Re-supply the injected local WebRTC sink for a board-configured local-sink run (the kernel
        // re-resolves the driver at start). For every other sink, leave sinkDriver unset — writing an
        // `undefined` key into the overrides would clobber defaultKernelOptions.sinkDriver, so the kernel
        // fails to resolve the driver (e.g. the in-memory test sink) and the worker hangs.
        const run = yield* store.require(runId);
        const localSink =
          run.config.sink.driverId === "local" ? yield* ensureLocalSink() : undefined;
        return yield* startRunEffect(
          store,
          scope,
          runId,
          mergeKernelOptions(defaultKernelOptions, {
            ...options,
            ...(localSink === undefined ? {} : { sinkDriver: localSink }),
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

    awaitRun: (runId) =>
      Effect.gen(function* () {
        const handle = yield* store.requireHandle(runId);
        return yield* handle.awaitResult();
      }),

    stopRun: (runId, options) => stopObserveRun(store, runId, options),

    removeRun: (runId) => store.remove(runId),
    removeHandle: (runId) => store.removeHandle(runId)
  };
};

const startRunEffect = (
  store: RunStore,
  scope: Scope.Scope,
  runId: string,
  options: RuntimeKernelOptions
) =>
  Effect.gen(function* () {
    yield* reclaimTerminalRunHandle(store, runId);
    const run = yield* store.require(runId);
    const handle = yield* startObserveRunAsync({
      run,
      options
    }).pipe(Effect.provideService(Scope.Scope, scope));
    yield* store.putHandle(handle);
    return handle;
  });

export const createObserveRuntime = (
  input: CreateObserveRuntimeInput = {}
): Effect.Effect<ObserveRuntime, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    return buildObserveRuntime(input, scope);
  });
