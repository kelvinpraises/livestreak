import { Effect, Scope } from "effect";
import type { LiveStreakError } from "@livestreak/core";
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
import {
  callStoredRunFunction,
  createRunStore,
  failIfActiveHandleExists,
  getStoredRunArtifact,
  readStoredRunBoard,
  readStoredRunPanel,
  subscribeStoredRunArtifacts,
  subscribeStoredRunBoard,
  type ObserveRunHandle,
  type RunStore
} from "./store.js";

export type { StopRunOptions } from "./kernel.js";
export { defaultStopTimeoutMs } from "./kernel.js";

export type RuntimeKernelOptions = ObserveRunKernelOptions & { readonly maxTurns?: number };

export interface CreateObserveRuntimeInput {
  readonly store?: RunStore;
  readonly defaultKernelOptions?: RuntimeKernelOptions;
}

export interface ObserveRuntime {
  readonly store: RunStore;

  readonly prepareRun: (
    config: ObserveRunConfig,
    options?: ObserveRunKernelOptions
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

  return {
    store,

    prepareRun: (config, options) =>
      Effect.gen(function* () {
        const run = yield* makeObserveRun(config);
        const prepared = yield* prepareObserveRun(
          run,
          mergeKernelOptions(defaultKernelOptions, options)
        );
        yield* store.put(prepared);
        return prepared;
      }),

    startRun: (runId, options) =>
      Effect.gen(function* () {
        yield* failIfActiveHandleExists(store, runId);
        const run = yield* store.require(runId);
        const handle = yield* startObserveRunAsync({
          run,
          options: mergeKernelOptions(defaultKernelOptions, options)
        }).pipe(Effect.provideService(Scope.Scope, scope));
        yield* store.putHandle(handle);
        return handle;
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

export const createObserveRuntime = (
  input: CreateObserveRuntimeInput = {}
): Effect.Effect<ObserveRuntime, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    return buildObserveRuntime(input, scope);
  });
