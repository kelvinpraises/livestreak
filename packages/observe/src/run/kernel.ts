import { Cause, Effect, Exit, Fiber, Option, Ref, type Scope } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import type { PackageRuntimeInit } from "@livestreak/schema";
import { getBuiltInCaptureDriver, getBuiltInSinkDriver } from "#builtins.js";
import type { CaptureDriver } from "#pipeline/capture/index.js";
import type { SinkDriver } from "#pipeline/publish/index.js";
import type { Board } from "./control/board/index.js";
import {
  clearBoardRunStopRequest,
  readBoardRunPrepared,
  setBoardRunPrepared,
  setBoardRunStatus
} from "./control/board/index.js";

import { buildControlCatalog } from "./control/catalog.js";
import { createControlBus, isStaleOwnerError } from "./control/bus/bus.js";
import type {
  ControlBus,
  ControlCellDefinition,
  ControlSurface,
  ExecutionLease,
  UpdateAuthority
} from "./control/bus/index.js";
import { runCellIdOf } from "./control/board/index.js";
import { validateBoardSettings } from "./control/board/index.js";
import { bootstrapLegacyObserveBoard } from "./control/board/legacy-bootstrap.js";
import { createObserveControlSurfaces } from "./control/surfaces.js";
import type { BoardPatch } from "./control/bus/types.js";
import type { SystemRunHooks } from "./control/system/run.js";
import { systemRunStopScope } from "./control/index.js";
import type { DescribeControlContext } from "./control/bus/index.js";
import type { ObserveRun } from "./run.js";
import { callStoredRunFunction, type ObserveRunHandle, type RunStore } from "./store.js";
import type { ObserveRunMarketOptions } from "#market/index.js";
import { runScopedWorkerUntilStoppedWithBoard } from "./worker/worker.js";
import type { WorkerRunOutcome } from "./worker/worker.js";
import { createWorkerBoardWake } from "./worker/wake.js";
import type { WorkerSnapshot } from "./worker/snapshot.js";
import type { SinkStageState } from "./worker/state.js";

export type { WorkerRunOutcome } from "./worker/worker.js";

export type ObserveRunOutcome = WorkerRunOutcome | "interrupted";

export interface ObserveRunResult {
  readonly outcome: ObserveRunOutcome;
  readonly board: Board;
  readonly snapshot?: WorkerSnapshot;
  readonly outputUri?: string;
}

export interface ObserveRunKernelOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injected capture drivers carry heterogeneous config shapes
  readonly captureDriver?: CaptureDriver<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injected sink drivers carry heterogeneous config shapes
  readonly sinkDriver?: SinkDriver<any>;
  readonly market?: ObserveRunMarketOptions;
  readonly sessionInit?: PackageRuntimeInit;
  readonly runHooks?: SystemRunHooks;
  /**
   * Execution lease reserved before forking. The async start path always passes the one it
   * reserved; a direct sync start reserves its own when absent.
   */
  readonly executionLease?: ExecutionLease;
  /**
   * Preparation ownership claimed by the caller (runtime spans it across store publication).
   * Absent: the kernel claims its own once the bus exists (direct callers, legacy bootstrap).
   */
  readonly preparationLease?: ExecutionLease;
}

export const defaultObserveRunMaxTurns = 4096;

export const prepareObserveRun = (
  run: ObserveRun,
  options: ObserveRunKernelOptions = {}
): Effect.Effect<ObserveRun, LiveStreakError> =>
  Effect.gen(function* () {
    yield* assertMarketCanBroadcast(run.bus === undefined ? run.board : yield* run.bus.readBoard(), run.config.obsId);
    const captureDriver = yield* resolveCaptureDriver(run.config.capture.driverId, options);
    const sinkDriver = yield* resolveSinkDriver(run.config.sink.driverId, options);

    const captureConfig = yield* captureDriver.validate(run.config.capture.config);
    const sinkConfig = yield* sinkDriver.validate(run.config.sink.config);

    // A board-first run already owns a live bus (the T0 mount): REUSE it. Creating a fresh bus
    // here would sever every existing board subscription (the console rail would freeze) and
    // unmount the pipeline configurators (a prepared run would refuse reconfiguration).
    // Prepared is a disposable derivation of the board — re-prepare just re-derives on the
    // same bus. The fresh-bus path remains for legacy callers that prepare without a T0 mount.
    let bus = run.bus;
    if (bus === undefined) {
      const board = setBoardRunStatus(
        bootstrapLegacyObserveBoard(run.board, run.config),
        "preparing",
        "validating observe run",
        Date.now(),
        run.config.obsId
      );
      bus = yield* createControlBus({
        runId: run.config.runId,
        board,
        catalog: buildControlCatalog(),
        surfaces: createObserveControlSurfaces({
          sessionInit: options.sessionInit,
          runHooks: options.runHooks
        })
      });
    }
    const prepareBus = bus;
    const prepareKey =
      run.config.obsId === undefined
        ? run.config.runId
        : `${run.config.runId}#${run.config.obsId}`;
    // Preparation ownership spans input capture through publication. A caller-held lease
    // (runtime, across store publication) wins; otherwise claim here once the bus exists.
    // Failure/interruption releases exactly this preparation and never publishes prepared.
    // One acquire/use/release bracket: a caller-held lease (runtime, across store
    // publication) wins; otherwise the self-claim and the cleanup installation share the
    // outer mask atomically, and restore applies only to the body once cleanup exists.
    // Failure/interruption releases exactly this preparation and never publishes prepared.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const preparationLease: ExecutionLease =
          options.preparationLease ??
          (yield* prepareBus.execution
            .claimPrepare(prepareKey)
            .pipe(Effect.map((token) => ({ obsKey: prepareKey, token }))));
        const releasePreparation =
          options.preparationLease === undefined
            ? prepareBus.execution.release(preparationLease.obsKey, preparationLease.token)
            : Effect.void;
        return yield* restore(
          Effect.gen(function* () {
            yield* assertMarketCanBroadcast(yield* prepareBus.readBoard(), run.config.obsId);
            yield* prepareBus.commitGuardedUpdate(
              { kind: "owner", lease: preparationLease },
              { kind: "lifecycle", ...(run.config.obsId === undefined ? {} : { obsId: run.config.obsId }) },
              (current) =>
                Effect.succeed(
                  setBoardRunStatus(
                    current,
                    "preparing",
                    "validating observe run",
                    Date.now(),
                    run.config.obsId
                  )
                )
            );

            const nowMs = Date.now();
            const sinkInstanceId = resolveSinkInstanceId(run.config);
            const captureContext: DescribeControlContext = {
              runId: run.config.runId,
              nowMs
            };
            const sinkContext: DescribeControlContext = {
              runId: run.config.runId,
              instanceId: sinkInstanceId,
              nowMs
            };

            const captureCell = yield* captureDriver.describeControl(captureConfig, captureContext);
            const sinkCell = yield* sinkDriver.describeControl(sinkConfig, sinkContext);
            if (run.config.obsId === undefined) {
              yield* prepareBus.mountStageCell(captureCell);
              yield* prepareBus.mountStageCell(sinkCell);
              yield* prepareBus.applyBoardPatch(markSinkCellConfiguredPatch(sinkCell.id));
            } else {
              // Owned family remap: the stage definitions land on the existing family cells
              // (address-only plus selective metadata), never as new global stage cells.
              yield* remapFamilyStageCells(
                prepareBus,
                preparationLease,
                run.config.obsId,
                captureCell,
                sinkCell
              );
            }

            const preparedBoard = yield* prepareBus.readBoard();
            yield* validateBoardSettings(preparedBoard, {
              ...(run.config.obsId === undefined ? {} : { obsId: run.config.obsId })
            });

            // Prepare owns prepared=true only after successful canonical preparation: single
            // guarded publication as the last step, then the caller publishes to its store.
            yield* prepareBus.commitGuardedUpdate(
              { kind: "owner", lease: preparationLease },
              { kind: "lifecycle", ...(run.config.obsId === undefined ? {} : { obsId: run.config.obsId }) },
              (current) =>
                Effect.succeed(
                  setBoardRunPrepared(
                    setBoardRunStatus(
                      current,
                      "prepared",
                      "observe run is ready to start",
                      Date.now(),
                      run.config.obsId
                    ),
                    true,
                    undefined,
                    run.config.obsId
                  )
                )
            );

              return {
                config: run.config,
                board: yield* prepareBus.readBoard(),
                bus: prepareBus,
                manifest: run.manifest,
                prepared: true
              };
          })
        ).pipe(Effect.ensuring(releasePreparation));
      })
    );
  });

export const startObserveRun = (
  run: ObserveRun,
  options: ObserveRunKernelOptions & { readonly maxTurns?: number } = {}
): Effect.Effect<ObserveRunResult, LiveStreakError> => {
  if (run.prepared === false || run.bus === undefined) {
    return Effect.fail(
      new LiveStreakRuntimeError({
        message: "Observe run must be prepared before start"
      })
    );
  }

  const preparedBus = run.bus;
  const obsKey =
    run.config.obsId === undefined ? run.config.runId : `${run.config.runId}#${run.config.obsId}`;

  // Outer owned lifecycle: holds the execution lease from acquisition through terminal
  // publication; the finalizer retires it only after the terminal write lands. The inner
  // resource scope (drivers/attach/source/wake/worker) completes first — terminal status is
  // published after awaited cleanup but before retirement, never after.
  return Effect.scoped(
    Effect.gen(function* () {
      const bus = preparedBus;
      // A direct (non-async) start reserves its own lease; the async path passes the one it
      // reserved before forking (with rollback if the fork never happens).
      // Owned acquisition with atomic release registration: acquireRelease installs the
      // release finalizer in the same mask as the reserve, so a pending interruption can
      // never land between acquisition and cleanup installation (a separate addFinalizer
      // yield after the mask would leave that gap).
      const lease: ExecutionLease = yield* Effect.acquireRelease(
        options.executionLease !== undefined
          ? Effect.succeed(options.executionLease)
          : bus.execution.reserve(obsKey).pipe(Effect.map((token) => ({ obsKey, token }))),
        (owned) => bus.execution.release(owned.obsKey, owned.token)
      );

      // Authoritative start gate: the board's canonical prepared flag (not the composite
      // run.prepared) decides. A demoted board must re-prepare — starting would run stale config.
      // Gate failures retire the lease silently (no terminal publication: nothing started).
      const gateBoard = yield* bus.readBoard();
      yield* assertMarketCanBroadcast(gateBoard, run.config.obsId);
      if (readBoardRunPrepared(gateBoard, run.config.obsId) === false) {
        return yield* Effect.fail(
          new LiveStreakConfigError({
            message: "Observation configuration changed — prepare again before starting."
          })
        );
      }

      // Terminal receipt channel + owning publication finalizer. Registered after the gate
      // (gate rejections stay silent) but before any startup work, so every startup defect,
      // worker failure, and interruption — including forced held-startup interruption —
      // publishes its terminal truth after awaited cleanup and before retirement. LIFO order
      // guarantees publication runs before the lease-retirement finalizer above. The worker
      // records its receipt on success; the finalizer derives failure/interruption truth from
      // the scope exit otherwise. No posthumous writes: after retirement every old write is
      // stale and rejected by the generation fence.
      const terminal = yield* Ref.make<TerminalReceipt | undefined>(undefined);
      yield* Effect.addFinalizer((scopeExit) =>
        Effect.gen(function* () {
          const recorded = yield* Ref.get(terminal);
          if (recorded !== undefined) {
            yield* publishTerminalOutcome(bus, lease, run.config.obsId, recorded);
          } else if (Exit.isFailure(scopeExit) && Cause.isInterruptedOnly(scopeExit.cause)) {
            yield* publishTerminalOutcome(bus, lease, run.config.obsId, {
              status: "failed",
              reason: "execution interrupted",
              outcome: "interrupted"
            });
          } else if (Exit.isFailure(scopeExit)) {
            const message = Cause.pretty(scopeExit.cause).split("\n")[0] ?? "run failed";
            yield* publishTerminalOutcome(bus, lease, run.config.obsId, {
              status: "failed",
              reason: message,
              outcome: "failed"
            });
          } else {
            yield* publishTerminalOutcome(bus, lease, run.config.obsId, {
              status: "failed",
              reason: "completed without terminal receipt",
              outcome: "failed"
            });
          }
        }).pipe(
          Effect.catchAll((error) =>
            isStaleOwnerError(error) ? Effect.void : Effect.die(error)
          )
        )
      );

      const lifecycleOp = {
        kind: "lifecycle",
        ...(run.config.obsId === undefined ? {} : { obsId: run.config.obsId })
      } as const;
      const fencedLifecycle = (
        update: (current: Board) => Board
      ): Effect.Effect<Board, LiveStreakError> =>
        bus.commitGuardedUpdate({ kind: "owner", lease }, lifecycleOp, (current) =>
          Effect.succeed(update(current))
        );

      const innerExit = yield* Effect.exit(
        Effect.scoped(
          Effect.gen(function* () {
            yield* fencedLifecycle((current) =>
              setBoardRunStatus(
                current,
                "starting",
                "starting observe run",
                Date.now(),
                run.config.obsId
              )
            );

            const captureDriver = yield* resolveCaptureDriver(run.config.capture.driverId, options);
            const sinkDriver = yield* resolveSinkDriver(run.config.sink.driverId, options);

            const captureConfig = yield* captureDriver.validate(run.config.capture.config);
            const sinkConfig = yield* sinkDriver.validate(run.config.sink.config);

            const attachment = yield* sinkDriver.attach(sinkConfig);
            if (attachment.control !== undefined) {
              if (run.config.obsId === undefined) {
                yield* bus.mountSurface(attachment.control);
              } else {
                // Owned binding: a family never mints a global stage cell for its control.
                yield* bus.mountStageCell(
                  yield* remapControlToOwner(bus, attachment.control, run.config.obsId)
                );
              }
            }

            const sinkInstanceId = resolveSinkInstanceId(run.config);
            const sinks: Record<string, SinkStageState> = {
              [sinkInstanceId]: {
                attachment,
                finalized: false,
                deliveredItems: 0,
                drainedTracks: {}
              }
            };

            // Lifetime-bound wake: this worker's wake dies with its scope — starting a sibling never
            // replaces it and stopping never silences the sibling.
            const boardWake = yield* createWorkerBoardWake();
            yield* Effect.acquireRelease(
              bus.registerWakeWorker(() => boardWake.notify()),
              (subscription) => subscription.unsubscribe()
            );

            // New execution initializes its own runtime facts so a prior run's counters,
            // finalization or output can never describe it.
            yield* resetExecutionFacts(bus, lease, run.config.obsId, sinkInstanceId);

            return yield* runScopedWorkerUntilStoppedWithBoard({
              runId: run.config.runId,
              ...(run.config.obsId === undefined ? {} : { obsId: run.config.obsId }),
              execution: lease,
              manifest: run.manifest,
              sinks,
              bus,
              boardWake,
              maxTurns: options.maxTurns ?? defaultObserveRunMaxTurns,
              prepareCapture: captureDriver.create(captureConfig)
            });
          })
        )
      );

      // The worker result carries the terminal receipt; the outer finalizer below publishes
      // it (or the failure/interruption truth) after awaited cleanup, before retirement.
      if (Exit.isFailure(innerExit)) {
        return yield* Effect.failCause(innerExit.cause);
      }
      const result = innerExit.value;
      const terminalStatus = result.outcome === "failed" ? "failed" : "stopped";
      const terminalReason =
        result.outcome === "failed"
          ? (result.snapshot.error ?? "worker failed")
          : "worker exited cleanly";
      yield* Ref.set(terminal, {
        status: terminalStatus,
        reason: terminalReason,
        outcome: result.outcome,
        outputUri:
          result.outcome === "stopped"
            ? readOutputUri(result.snapshot, resolveSinkInstanceId(run.config))
            : undefined
      });
      const board = yield* bus.readBoard();
      return {
        outcome: result.outcome,
        board,
        snapshot: result.snapshot,
        outputUri: readOutputUri(result.snapshot, resolveSinkInstanceId(run.config))
      };
    })
  );
};

export interface StartObserveRunAsyncInput {
  readonly run: ObserveRun;
  readonly options?: ObserveRunKernelOptions & { readonly maxTurns?: number };
}

export const startObserveRunAsync = (
  input: StartObserveRunAsyncInput
): Effect.Effect<ObserveRunHandle, LiveStreakError, Scope.Scope> =>
  Effect.gen(function* () {
    const { run, options } = input;

    if (run.prepared === false || run.bus === undefined) {
      return yield* Effect.fail(
        new LiveStreakRuntimeError({
          message: "Observe run must be prepared before start"
        })
      );
    }

    // Authoritative start gate (checked before reserving, so a demoted board fails fast with
    // no lease churn and no handle minted): the board's canonical prepared flag decides.
    const gateBoard = yield* run.bus.readBoard();
    yield* assertMarketCanBroadcast(gateBoard, run.config.obsId);
    if (readBoardRunPrepared(gateBoard, run.config.obsId) === false) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: "Observation configuration changed — prepare again before starting."
        })
      );
    }

    const obsKey =
      run.config.obsId === undefined ? run.config.runId : `${run.config.runId}#${run.config.obsId}`;
    // Reserve before fork: the second concurrent starter fails HERE (no worker forked, no
    // handle minted) instead of racing the first inside the run. Interruption (or failure)
    // between reservation and a live child rolls the orphan back — no child exists to retire
    // it, so the acquisition itself releases. The surviving child's outer scope owns
    // retirement after terminal publication.
    const bus = run.bus;
    // One acquire/use/release bracket: reservation and cleanup installation share the
    // outer mask atomically; restore applies only to the stop-clear + fork body once
    // cleanup exists. A failed stop-clear or a cancelled fork releases the orphan (no
    // child exists to retire it); after handoff the child owns retirement.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const token = yield* bus.execution.reserve(obsKey);
        const lease: ExecutionLease = { obsKey, token };
        let handedOff = false;
        let child: Fiber.Fiber<ObserveRunResult, LiveStreakError> | undefined;
        const rollbackAcquisition = Effect.gen(function* () {
          if (handedOff) {
            return;
          }
          if (child !== undefined) {
            yield* Fiber.interrupt(child);
            yield* Fiber.await(child);
          }
          yield* bus.execution.release(obsKey, token);
        });
        const fiber = yield* restore(
          Effect.gen(function* () {
            // A stop request is a one-shot command for the PREVIOUS execution. Consume
            // any stale one AFTER reservation but BEFORE forking (fenced with the new
            // lease): sequenced with the caller so a restarted run never drains on stale
            // input, and a stop issued after start returns is never eaten by the run fiber.
            yield* bus.commitGuardedUpdate(
              { kind: "owner", lease },
              { kind: "lifecycle", ...(run.config.obsId === undefined ? {} : { obsId: run.config.obsId }) },
              (current) => Effect.succeed(clearBoardRunStopRequest(current, run.config.obsId))
            );
            const forked = yield* Effect.forkScoped(
              startObserveRun(run, { ...options, executionLease: lease })
            );
            child = forked;
            handedOff = true;
            return forked;
          })
        ).pipe(Effect.ensuring(rollbackAcquisition));

      let interrupted = false;

      const handle: ObserveRunHandle = {
        runId: run.config.runId,
        run,
        bus,
        execution: lease,
        startedAtMs: Date.now(),
        awaitResult: () => Fiber.join(fiber),
        isDone: Fiber.poll(fiber).pipe(Effect.map(Option.isSome)),
        interrupt: Effect.gen(function* () {
          if (interrupted) {
            return;
          }

          interrupted = true;
          yield* Fiber.interrupt(fiber);
        })
      };

      return handle;
      })
    );
  });

export const defaultStopTimeoutMs = 5000;

export interface StopRunOptions {
  readonly reason?: string;
  readonly timeoutMs?: number;
}

export const stopObserveRun = (
  store: RunStore,
  runId: string,
  options?: StopRunOptions,
  obsId?: string
): Effect.Effect<ObserveRunResult, LiveStreakError> =>
  Effect.gen(function* () {
    const handleKey = obsId === undefined ? runId : `${runId}#${obsId}`;
    const handle = yield* store.requireHandle(handleKey);
    const timeoutMs = yield* validateStopTimeoutMs(options?.timeoutMs);
    // Idempotent fast path: a completed run whose board already records terminal status
    // returns its result without dispatching — a stale handle lease must never be used to
    // write a new stop command onto a retired (possibly restarted) generation.
    if (yield* handle.isDone) {
      const terminalBoard = yield* handle.bus.readBoard();
      const runCellId =
        obsId === undefined ? runCellIdOf(terminalBoard) ?? "system:run" : `obs:${obsId}:run`;
      const status = terminalBoard.cells[runCellId]?.status[0];
      if (status === "stopped" || status === "failed") {
        return yield* handle.awaitResult();
      }
    }
    const bus = handle.bus;
    // The stop command commits against the selected handle's own execution identity (or a
    // captured entry ticket for legacy handles): a stale stop never sets stopRequested on a
    // successor generation — the fenced commit rejects it instead.
    const authority: UpdateAuthority =
      handle.execution !== undefined
        ? { kind: "owner", lease: handle.execution }
        : {
            kind: "ticket",
            ticket: {
              obsKey: handleKey,
              token: (yield* bus.execution.readEntry(handleKey)).token
            }
          };
    yield* callStoredRunFunction(
      store,
      {
        callId: `stop-${handleKey}`,
        runId,
        ...(obsId === undefined ? {} : { cellId: `obs:${obsId}:run` }),
        scope: systemRunStopScope,
        ...(options?.reason === undefined ? {} : { payload: { reason: options.reason } })
      },
      authority
    );

    const raced = yield* Effect.race(
      handle.awaitResult().pipe(Effect.map((result) => ({ tag: "completed" as const, result }))),
      Effect.sleep(`${timeoutMs} millis`).pipe(Effect.map(() => ({ tag: "timeout" as const })))
    );

    if (raced.tag === "completed") {
      // Terminal status was published by the owning lifecycle before the join resolved.
      return raced.result;
    }

    yield* handle.interrupt;

    // The outer owning lifecycle observes this interruption with awaited cleanup and
    // publishes failed/outcome=interrupted before retiring; stop establishes no
    // independent pre-cleanup terminal writer. The result below keeps this call's actual
    // timeout context and never claims the successor.
    const afterInterrupt = yield* Effect.exit(handle.awaitResult());
    if (Exit.isSuccess(afterInterrupt)) {
      return afterInterrupt.value;
    }
    // A non-interrupt failure (e.g. a cleanup defect) propagates — it must never hide
    // behind an interrupted-success. Only pure interruption becomes outcome:interrupted.
    if (!Cause.isInterruptedOnly(afterInterrupt.cause)) {
      return yield* afterInterrupt;
    }
    return {
      outcome: "interrupted",
      board: yield* bus.readBoard()
    };
  });

// --- helpers ---

const resolveSinkInstanceId = (config: ObserveRun["config"]): string => {
  if (config.sink.instanceId !== undefined) {
    return config.sink.instanceId;
  }

  if (config.sink.driverId === "memory") {
    return "memory-sink";
  }

  if (config.sink.driverId === "live") {
    return "live";
  }

  if (config.sink.driverId === "direct") {
    return "direct";
  }

  return "file-export";
};

/**
 * Owned family stage remap (DQ2): the driver's stage definitions land on the existing
 * family cells — address-only plus selective metadata — never as new global stage cells.
 * Preserved: family settings, catalog, advertised functions, label and stage status, plus
 * readonly obsId/kind/configured and market identity markers. Derived: capture
 * sourceType/sourceMode from the validated selected driver (refreshes kind switches) and
 * publish streamId from this family's registered market. Never adopts arbitrary driver
 * readonly defaults, and never flips configured (the completeness gate owns that).
 */
const remapFamilyStageCells = (
  bus: ControlBus,
  lease: ExecutionLease,
  obsId: string,
  captureCell: ControlCellDefinition,
  sinkCell: ControlCellDefinition
): Effect.Effect<void, LiveStreakError> =>
  bus
    .commitGuardedUpdate({ kind: "owner", lease }, { kind: "prepareMeta", obsId }, (current) =>
      Effect.gen(function* () {
        const captureId = `obs:${obsId}:capture`;
        const publishId = `obs:${obsId}:publish`;
        const familyCapture = current.cells[captureId];
        const familyPublish = current.cells[publishId];
        if (familyCapture === undefined || familyPublish === undefined) {
          return yield* Effect.fail(
            new LiveStreakConfigError({
              message: `Prepare remap requires family cells for observation ${obsId}`
            })
          );
        }
        // The stage driver must serve this family's configured kind; anything else is a
        // preparation input error, not a silent remap.
        if (
          sinkCell.cell.catalog !== undefined &&
          sinkCell.cell.catalog !== familyPublish.catalog
        ) {
          return yield* Effect.fail(
            new LiveStreakConfigError({
              message:
                `Prepare sink ${sinkCell.cell.catalog ?? "unknown"} does not serve family publish ` +
                `${familyPublish.catalog ?? "unknown"} for observation ${obsId}`
            })
          );
        }
        const marketId = current.cells[`obs:${obsId}:market`]?.readonly?.marketId;
        const captureReadonly = captureCell.cell.readonly ?? {};
        const nextCaptureReadonly: Record<string, unknown> = { ...familyCapture.readonly };
        if (typeof captureReadonly.sourceType === "string") {
          nextCaptureReadonly.sourceType = captureReadonly.sourceType;
        }
        if (typeof captureReadonly.sourceMode === "string") {
          nextCaptureReadonly.sourceMode = captureReadonly.sourceMode;
        }
        void sinkCell;
        const nextPublishReadonly: Record<string, unknown> = { ...familyPublish.readonly };
        if (typeof marketId === "string" && marketId.length > 0) {
          nextPublishReadonly.streamId = marketId;
        }
        if (
          jsonEqualShallow(familyCapture.readonly ?? {}, nextCaptureReadonly) &&
          jsonEqualShallow(familyPublish.readonly ?? {}, nextPublishReadonly)
        ) {
          return current;
        }
        return {
          ...current,
          cells: {
            ...current.cells,
            [captureId]: { ...familyCapture, readonly: nextCaptureReadonly },
            [publishId]: { ...familyPublish, readonly: nextPublishReadonly }
          }
        };
      })
    )
    .pipe(Effect.asVoid);

const jsonEqualShallow = (left: Record<string, unknown>, right: Record<string, unknown>): boolean => {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.is(left[key], right[key]));
};

/** Terminal receipt recorded by a completed worker for the owning publication finalizer. */
interface TerminalReceipt {
  readonly status: "stopped" | "failed";
  readonly reason: string;
  readonly outcome: string;
  readonly outputUri?: string;
}

/**
 * Owning terminal publication: status, reason, outcome and real finalize receipt land
 * together under the still-current execution lease. Identical status+reason is a natural
 * no-op; a provisional stopped is corrected to failed (cleanup failure must never certify
 * success), but receipt fields always refresh — outcome/outputUri describe this execution.
 */
const publishTerminalOutcome = (
  bus: ControlBus,
  lease: ExecutionLease,
  obsId: string | undefined,
  terminal: {
    status: "stopped" | "failed";
    reason: string;
    outcome: string;
    outputUri?: string;
  }
): Effect.Effect<void, LiveStreakError> =>
  bus
    .commitGuardedUpdate(
      { kind: "owner", lease },
      { kind: "lifecycle", ...(obsId === undefined ? {} : { obsId }) },
      (current) =>
        Effect.succeed(applyTerminalRunReceipt(current, terminal, obsId))
    )
    .pipe(Effect.asVoid);

const applyTerminalRunReceipt = (
  current: Board,
  terminal: { status: "stopped" | "failed"; reason: string; outcome: string; outputUri?: string },
  obsId: string | undefined
): Board => {
  const withStatus = applyTerminalRunStatus(current, terminal.status, terminal.reason, obsId);
  const runCellId = runCellIdOf(withStatus, undefined, obsId) ?? "system:run";
  const runCell = withStatus.cells[runCellId];
  if (runCell === undefined) {
    return withStatus;
  }
  const readonly: Record<string, unknown> = { ...runCell.readonly, outcome: terminal.outcome };
  if (terminal.outputUri === undefined) {
    delete readonly.outputUri;
  } else {
    readonly.outputUri = terminal.outputUri;
  }
  return {
    ...withStatus,
    cells: { ...withStatus.cells, [runCellId]: { ...runCell, readonly } }
  };
};

/**
 * Conditional terminal status: identical status+reason is a no-op returning the current
 * board; any differing terminal state applies (including stopped→failed correction when
 * cleanup fails after a provisional stop). Never blanket-gated on nonterminal.
 */
const applyTerminalRunStatus = (
  current: Board,
  status: "stopped" | "failed",
  reason: string,
  obsId: string | undefined
): Board => {
  const runCellId = runCellIdOf(current, undefined, obsId) ?? "system:run";
  const runCell = current.cells[runCellId];
  if (runCell === undefined) {
    return current;
  }
  if (runCell.status[0] === status && runCell.status[1] === reason) {
    return current;
  }
  return {
    ...current,
    cells: {
      ...current.cells,
      [runCellId]: { ...runCell, status: [status, reason, Date.now()] }
    }
  };
};

/**
 * New-execution facts initialization: clear the prior run's counters, finalization, output
 * and capture exhaustion so stale receipts can never describe the new run. Fenced with the
 * new lease; legacy bare runs reset their stage cells the same way.
 */
const resetExecutionFacts = (
  bus: ControlBus,
  lease: ExecutionLease,
  obsId: string | undefined,
  sinkInstanceId: string
): Effect.Effect<void, LiveStreakError> =>
  bus
    .commitGuardedUpdate(
      { kind: "owner", lease },
      { kind: "snapshot", ...(obsId === undefined ? {} : { obsId }) },
      (current) =>
        Effect.succeed(resetFactsBoard(current, obsId, sinkInstanceId))
    )
    .pipe(Effect.asVoid);

const resetFactsBoard = (current: Board, obsId: string | undefined, sinkInstanceId: string): Board => {
  const publishId = obsId === undefined ? `sink:${sinkInstanceId}` : `obs:${obsId}:publish`;
  const captureId =
    obsId === undefined
      ? undefined
      : `obs:${obsId}:capture`;
  const runId = runCellIdOf(current, undefined, obsId) ?? "system:run";
  let cells = current.cells;
  let touched = false;
  // Restart clears the prior run receipt too: outcome/outputUri describe an execution,
  // never the family across generations.
  const runCell = cells[runId];
  if (runCell !== undefined) {
    const readonly = { ...runCell.readonly };
    let runTouched = false;
    for (const key of ["outcome", "outputUri"]) {
      if (key in readonly) {
        delete readonly[key];
        runTouched = true;
      }
    }
    if (runTouched) {
      cells = { ...cells, [runId]: { ...runCell, readonly } };
      touched = true;
    }
  }
  const publish = cells[publishId];
  if (publish !== undefined) {
    const readonly = { ...publish.readonly };
    for (const key of ["deliveredItems", "finalized", "outputUri"]) {
      if (key in readonly) {
        delete readonly[key];
        touched = true;
      }
    }
    if (touched) {
      cells = { ...cells, [publishId]: { ...publish, readonly } };
    }
  }
  if (captureId !== undefined) {
    const capture = cells[captureId];
    if (capture !== undefined) {
      const readonly = { ...capture.readonly };
      let captureTouched = false;
      for (const key of ["exhausted", "eosAppended"]) {
        if (key in readonly) {
          delete readonly[key];
          captureTouched = true;
        }
      }
      if (captureTouched) {
        cells = { ...cells, [captureId]: { ...capture, readonly } };
        touched = true;
      }
    }
  }
  return touched ? { ...current, cells } : current;
};

/**
 * Owner binding for attachment controls: rewrite the control definition onto the family's
 * publish cell so no global stage cell is minted and no callback can address another family.
 * The family's advertised functions are preserved (a control must satisfy the same binding
 * to be genuinely target-mounted); routing otherwise uses the validated canonical route.
 */
const remapControlToOwner = (
  bus: ControlBus,
  control: ControlSurface,
  obsId: string
): Effect.Effect<ControlCellDefinition, LiveStreakError> =>
  Effect.gen(function* () {
    const ownerId = `obs:${obsId}:publish`;
    const owner = (yield* bus.readBoard()).cells[ownerId];
    if (owner === undefined) {
      return yield* Effect.fail(
        new LiveStreakConfigError({
          message: `Attachment control has no owning family cell ${ownerId}`
        })
      );
    }
    // Preserve the family's advertised functions: the board cell keeps routing exactly what
    // the family advertises; control-specific functions use the validated canonical route.
    return {
      id: ownerId,
      cell: { ...control.cell.cell, functions: [...owner.functions] }
    };
  });

const markSinkCellConfiguredPatch = (cellId: string): BoardPatch => ({
  cells: {
    [cellId]: {
      readonly: {
        set: { configured: true }
      }
    }
  }
});

const resolveSinkDriver = (
  sinkDriverId: string,
  options: ObserveRunKernelOptions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- built-in and injected drivers share one resolution path
): Effect.Effect<SinkDriver<any>, LiveStreakConfigError> => {
  if (options.sinkDriver !== undefined) {
    if (options.sinkDriver.descriptor.id !== sinkDriverId) {
      return Effect.fail(
        new LiveStreakConfigError({
          message: `Injected sink driver id "${options.sinkDriver.descriptor.id}" does not match requested "${sinkDriverId}"`
        })
      );
    }
    return Effect.succeed(options.sinkDriver);
  }

  if (sinkDriverId === "file") {
    return Effect.succeed(getBuiltInSinkDriver("file"));
  }

  return Effect.fail(
    new LiveStreakConfigError({
      message: `Unknown sink driver "${sinkDriverId}"`
    })
  );
};

const resolveCaptureDriver = (
  captureDriverId: string,
  options: ObserveRunKernelOptions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- built-in and injected drivers share one resolution path
): Effect.Effect<CaptureDriver<any>, LiveStreakConfigError> => {
  if (options.captureDriver !== undefined) {
    if (options.captureDriver.descriptor.id !== captureDriverId) {
      return Effect.fail(
        new LiveStreakConfigError({
          message: `Injected capture driver id "${options.captureDriver.descriptor.id}" does not match requested "${captureDriverId}"`
        })
      );
    }
    return Effect.succeed(options.captureDriver);
  }

  if (captureDriverId === "file" || captureDriverId === "synthetic" || captureDriverId === "ingest" || captureDriverId === "rtmp") {
    return Effect.succeed(getBuiltInCaptureDriver(captureDriverId));
  }

  return Effect.fail(
    new LiveStreakConfigError({
      message: `Unknown capture driver "${captureDriverId}"`
    })
  );
};

const readOutputUri = (snapshot: WorkerSnapshot, sinkInstanceId: string): string | undefined => {
  const sink = snapshot.sinks[sinkInstanceId];
  if (sink === undefined) {
    return undefined;
  }
  return sink.finalizeResult?.output?.uri;
};

const validateStopTimeoutMs = (
  timeoutMs: unknown
): Effect.Effect<number, LiveStreakConfigError> => {
  if (timeoutMs === undefined) {
    return Effect.succeed(defaultStopTimeoutMs);
  }

  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "stopRun timeoutMs must be a finite number"
      })
    );
  }

  if (timeoutMs < 0) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "stopRun timeoutMs must be greater than or equal to 0"
      })
    );
  }

  return Effect.succeed(timeoutMs);
};

/** An ended observation cannot restart a producer under its old public market identity. */
const assertMarketCanBroadcast = (board: Board, obsId: string | undefined): Effect.Effect<void, LiveStreakConfigError> => {
  const cell = board.cells[obsId === undefined ? "market" : `obs:${obsId}:market`];
  const pending = cell?.readonly?.endSubmission as { marketId?: string; hash?: string } | undefined;
  if (pending?.hash && pending.marketId === cell?.readonly?.marketId) {
    return Effect.fail(new LiveStreakConfigError({ message: "Confirm the pending stream end before broadcasting again." }));
  }
  return cell?.readonly?.registrationState === "ended" || cell?.status[0] === "ended"
    ? Effect.fail(new LiveStreakConfigError({ message: "This market has ended. Create a new observation to broadcast again." }))
    : Effect.void;
};
