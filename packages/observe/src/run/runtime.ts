import { Effect, Scope } from "effect";
import { LiveStreakConfigError, type LiveStreakError } from "@livestreak/core";
import type { PackageRuntimeInit } from "@livestreak/schema";
import type { ControlCallEnvelope, ControlCallResult, ControlArtifact } from "./control/bus/index.js";
import type {
  ArtifactSubscription,
  BoardSubscription,
  ControlPanel
} from "./control/bus/index.js";
import type { Board } from "./control/board/index.js";
import { setBoardRunPrepared } from "./control/board/index.js";
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
    options: { readonly hostBaseUrl?: string; readonly obsId?: string }
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

// Driver precedence: an explicit per-start injection wins; an applicable explicit default
// wins over the cached built-in; the cache is fallback only. Absent/undefined never erases
// a valid default — the kernel fails loudly on descriptor-id mismatches instead.
const selectDriver = <D>(
  driverId: string,
  injected: D | undefined,
  configuredDefault: D | undefined,
  cached: () => D | undefined
): D | undefined => injected ?? configuredDefault ?? cached();

// Host resolution: an explicit URL wins and is retained per key on success; otherwise
// the retained context, otherwise the session default. Failed preparation never
// poisons the retained context.
const assertDeploymentHostUrl = (
  url: string | undefined
): Effect.Effect<string, LiveStreakError> => {
  if (url === undefined || url.length === 0) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "Prepare requires a host base URL (pass hostBaseUrl or session hostUrl)"
      })
    );
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("not http(s)");
    }
  } catch {
    return Effect.fail(
      new LiveStreakConfigError({ message: `Prepare host base URL is not a valid http(s) URL: ${url}` })
    );
  }
  return Effect.succeed(url);
};

const buildObserveRuntime = (
  input: CreateObserveRuntimeInput,
  scope: Scope.Scope
): ObserveRuntime => {
  const store = input.store ?? createRunStore();
  const defaultKernelOptions = input.defaultKernelOptions;
  const sessionInit = input.sessionInit;
  // Retained deployment contexts per run key: an explicit host URL stays selected for
  // later hook prepares; a failed preparation never poisons them; removeRun drops them.
  const preparedHostContext = new Map<string, string>();

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

  // Canonical family preparation shared by public prepareConfiguredRun and wired run hooks:
  // resolve the observation, reclaim, claim preparing ownership, register if needed,
  // rederive canonical inputs (never cached config), select drivers, prepare the kernel,
  // publish to the store, release. Host context: explicit URL wins and is retained per key
  // on success; otherwise the retained context, otherwise the session default.
  const prepareFamilyCanonical = (
    runId: string,
    obsId: string | undefined,
    explicitHostBaseUrl: string | undefined
  ): Effect.Effect<ObserveRun, LiveStreakError> =>
    Effect.gen(function* () {
      const run = yield* store.require(runId);
      const prepareBus = run.bus;
      if (prepareBus === undefined) {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: `Prepare requires a mounted control bus for run ${runId}`
          })
        );
      }
      // Canonical inputs come from the LIVE bus board — never the store's board copy,
      // which lags direct configure calls that bypass bridge sync. Deriving from a stale
      // copy would store old config while certifying prepared=true (false certification).
      const liveBoard = yield* prepareBus.readBoard();
      const index = readObservationIndex(liveBoard);
      const resolvedObsId =
        obsId ?? (Object.keys(index).length === 1 ? Object.keys(index)[0] : undefined);
      const key = runKey(runId, resolvedObsId);
      yield* reclaimTerminalRunHandle(store, key);
      // Admission read: a protected phase held by anyone (preparing/configuring/executing)
      // refuses the prepare before claiming — the claim itself enforces this too, but the
      // explicit read makes the refusal observable and auditable at the boundary.
      const admission = yield* prepareBus.execution.readEntry(key);
      if (admission.phase !== "inactive") {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: `Observation ${key} is already ${admission.phase} — prepare refused`
          })
        );
      }
      const hostBaseUrl = yield* assertDeploymentHostUrl(
        explicitHostBaseUrl ?? preparedHostContext.get(key) ?? sessionInit?.hostUrl
      );
      // One acquire/use/release bracket: the claim and the cleanup installation share
      // the outer mask atomically; restore applies only to the body once cleanup exists.
      // On failure or interruption after the bus certified prepared, the certification
      // rolls back (prepared=false) before release — a cancelled publication can never
      // leave a stale prepared=true behind.
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const prepareToken = yield* prepareBus.execution.claimPrepare(key);
          const preparationLease = { obsKey: key, token: prepareToken };
          return yield* restore(
            Effect.gen(function* () {
              const freshBoard = yield* prepareBus.readBoard();
              const marketCell =
                resolvedObsId === undefined
                  ? undefined
                  : freshBoard.cells[observationCellId(resolvedObsId, "market")];
              if (
                resolvedObsId !== undefined &&
                marketCell !== undefined &&
                marketCell.readonly?.registrationState === "none"
              ) {
                yield* prepareBus.dispatchCall(
                  {
                    callId: `prepare-register-${runId}-${resolvedObsId}`,
                    runId,
                    cellId: observationCellId(resolvedObsId, "market"),
                    scope: "market:register",
                    payload: {}
                  },
                  { kind: "owner", lease: preparationLease }
                );
              }
              const config = yield* runConfigFromBoard({
                runId,
                board: yield* prepareBus.readBoard(),
                hostBaseUrl,
                ...(sessionInit?.hostApiToken ? { hostApiToken: sessionInit.hostApiToken } : {}),
                ...(resolvedObsId === undefined ? {} : { obsId: resolvedObsId })
              });
              const sinkDriver =
                selectDriver(
                  config.sink.driverId,
                  undefined,
                  defaultKernelOptions?.sinkDriver,
                  () => streamingSinkFor(config.sink.driverId)
                );
              const prepared = yield* prepareObserveRun(
                { ...run, config, manifest: run.manifest, prepared: false },
                mergeKernelOptions(defaultKernelOptions, {
                  ...(sinkDriver === undefined ? {} : { sinkDriver }),
                  preparationLease,
                  sessionInit,
                  runHooks
                })
              );
              // Publication handoff: the store write and the bus prepared-commit must agree.
              // If publication fails after the bus certified prepared, roll the bus flag back
              // (fenced, still preparing) so a stale prepared=true can never satisfy a start.
              // The rollback is best-effort; the original publication failure propagates.
              const published = yield* Effect.exit(store.replace(prepared, key));
              if (published._tag === "Failure") {
                yield* prepareBus
                  .commitGuardedUpdate(
                    { kind: "owner", lease: preparationLease },
                    {
                      kind: "lifecycle",
                      ...(resolvedObsId === undefined ? {} : { obsId: resolvedObsId })
                    },
                    (current) =>
                      Effect.succeed(
                        setBoardRunPrepared(current, false, undefined, resolvedObsId)
                      )
                  )
                  .pipe(Effect.ignore);
                preparedHostContext.delete(key);
                return yield* Effect.failCause(published.cause);
              }
              preparedHostContext.set(key, hostBaseUrl);
              return prepared;
            })
          ).pipe(
            Effect.onExit((exit) =>
              exit._tag === "Failure"
                ? Effect.gen(function* () {
                    yield* prepareBus
                      .commitGuardedUpdate(
                        { kind: "owner", lease: preparationLease },
                        {
                          kind: "lifecycle",
                          ...(resolvedObsId === undefined ? {} : { obsId: resolvedObsId })
                        },
                        (current) =>
                          Effect.succeed(
                            setBoardRunPrepared(current, false, undefined, resolvedObsId)
                          )
                      )
                      .pipe(Effect.ignore);
                    yield* prepareBus.execution.release(key, prepareToken);
                  })
                : prepareBus.execution.release(key, prepareToken)
            )
          );
        })
      );
    });

  const runHooks: import("./control/system/run.js").SystemRunHooks = {
    // No cached-ready shortcut: a hook prepare always runs the canonical routine,
    // which rederives from the live board. A cached composite can certify a run whose
    // inputs changed after its read; the canonical routine truthfully refuses if owned
    // and otherwise rederives, admits, registers and publishes.
    prepare: (runId: string, obsId?: string) => prepareFamilyCanonical(runId, obsId, undefined),
    // Wired hooks share the canonical admitted start path (same driver selection as
    // public startRun): a live family started through hooks resolves its sink driver
    // instead of failing unknown-driver.
    start: (runId: string, obsId?: string) =>
      Effect.gen(function* () {
        const key = runKey(runId, obsId);
        const run = yield* store.get(key).pipe(
          Effect.flatMap((entry) =>
            entry !== undefined ? Effect.succeed(entry) : store.require(runId)
          )
        );
        const sinkDriver =
          selectDriver(
            run.config.sink.driverId,
            undefined,
            defaultKernelOptions?.sinkDriver,
            () => streamingSinkFor(run.config.sink.driverId)
          );
        const captureDriver = selectDriver(
          run.config.capture.driverId,
          undefined,
          defaultKernelOptions?.captureDriver,
          () => undefined
        );
        return yield* startRunEffect(
          store,
          scope,
          key,
          mergeKernelOptions(defaultKernelOptions, {
            ...(sinkDriver === undefined ? {} : { sinkDriver }),
            ...(captureDriver === undefined ? {} : { captureDriver }),
            sessionInit,
            runHooks
          })
        );
      }),
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
      prepareFamilyCanonical(runId, options.obsId, options.hostBaseUrl),

    startRun: (runId, options, obsId) =>
      Effect.gen(function* () {
        // Driver precedence: explicit per-start injection wins; an applicable explicit default
        // wins over the cached built-in; the cache is fallback only. Absent/undefined never
        // erases a valid default — the kernel fails loudly on descriptor-id mismatches.
        const key = runKey(runId, obsId);
        const run = yield* store.get(key).pipe(
          Effect.flatMap((entry) => (entry !== undefined ? Effect.succeed(entry) : store.require(runId)))
        );
        const sinkDriver = selectDriver(
          run.config.sink.driverId,
          options?.sinkDriver,
          defaultKernelOptions?.sinkDriver,
          () => streamingSinkFor(run.config.sink.driverId)
        );
        return yield* startRunEffect(
          store,
          scope,
          key,
          mergeKernelOptions(defaultKernelOptions, {
            ...options,
            ...(sinkDriver === undefined ? {} : { sinkDriver: sinkDriver }),
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

    removeRun: (runId) =>
      Effect.gen(function* () {
        yield* store.remove(runId);
        // Drop retained deployment contexts for the run and all its families (bounded scan
        // of the private map; never the store or board). A new session starts context-free.
        for (const key of [...preparedHostContext.keys()]) {
          if (key === runId || key.startsWith(`${runId}#`)) {
            preparedHostContext.delete(key);
          }
        }
      }),
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
    // Publication failure or cancellation must not orphan a live child: interrupt and
    // await its cleanup (the kernel scope finalizer retires the lease) before propagating.
    // onExit (not catchAll) observes interruption as well as failure.
    yield* Effect.onExit(store.putHandle(handle, key), (exit) =>
      exit._tag === "Failure"
        ? Effect.gen(function* () {
            yield* handle.interrupt;
            yield* Effect.exit(handle.awaitResult());
          }).pipe(Effect.ignore)
        : Effect.void
    );
    return handle;
  });

export const createObserveRuntime = (
  input: CreateObserveRuntimeInput = {}
): Effect.Effect<ObserveRuntime, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    return buildObserveRuntime(input, scope);
  });
