import { Effect, Exit, Fiber, type Scope } from "effect";
import { LiveStreakConfigError, LiveStreakRuntimeError, type LiveStreakError } from "@livestreak/core";
import { getBuiltInCaptureDriver, getBuiltInSinkDriver } from "#builtins.js";
import type { CaptureDriver } from "#pipeline/capture/index.js";
import type { SinkDriver } from "#pipeline/publish/index.js";
import type { Board } from "./control/board/index.js";
import { setBoardRunPrepared, setBoardRunStatus } from "./control/board/index.js";
import { buildControlCatalog } from "./control/catalog.js";
import { createControlBus, stageCellSurface } from "./control/bus/index.js";
import { applyWorkerSnapshotToBoard } from "./control/board/index.js";
import { validateBoardSettings } from "./control/board/index.js";
import { createSystemPauseSurface } from "./control/index.js";
import { createSystemRunSurface, systemRunStopScope } from "./control/index.js";
import type { DescribeControlContext } from "./control/bus/index.js";
import type { ObserveRun } from "./run.js";
import { callStoredRunFunction, type ObserveRunHandle, type RunStore } from "./store.js";
import type { ObserveRunMarketOptions } from "#market/index.js";
import {
  forkMarketRegistrationIfNeeded,
  resolveMarketRegistrarFromOptions
} from "#market/index.js";
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
}

export const defaultObserveRunMaxTurns = 4096;

export const prepareObserveRun = (
  run: ObserveRun,
  options: ObserveRunKernelOptions = {}
): Effect.Effect<ObserveRun, LiveStreakError> =>
  Effect.gen(function* () {
    const captureDriver = yield* resolveCaptureDriver(run.config.capture.driverId, options);
    const sinkDriver = yield* resolveSinkDriver(run.config.sink.driverId, options);

    const captureConfig = yield* captureDriver.validate(run.config.capture.config);
    const sinkConfig = yield* sinkDriver.validate(run.config.sink.config);

    let board = setBoardRunStatus(run.board, "preparing", "validating observe run");

    const bus = yield* createControlBus({
      runId: run.config.runId,
      board,
      catalog: buildControlCatalog(),
      surfaces: [createSystemPauseSurface(), createSystemRunSurface()]
    });

    const nowMs = Date.now();
    const sinkInstanceId = run.config.sink.instanceId ?? "file-export";
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
    yield* bus.mountSurface(stageCellSurface(captureCell));

    const sinkCell = yield* sinkDriver.describeControl(sinkConfig, sinkContext);
    yield* bus.mountSurface(stageCellSurface(sinkCell));

    board = yield* bus.readBoard();
    yield* validateBoardSettings(board);

    board = setBoardRunStatus(board, "prepared", "observe run is ready to start");
    board = setBoardRunPrepared(board, true);
    yield* bus.commitBoard(board);

    return {
      config: run.config,
      board: yield* bus.readBoard(),
      bus,
      manifest: run.manifest,
      prepared: true
    };
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

  return Effect.scoped(
    Effect.gen(function* () {
      const bus = preparedBus;

      yield* bus.commitBoard(
        setBoardRunStatus(yield* bus.readBoard(), "starting", "starting observe run")
      );

      const captureDriver = yield* resolveCaptureDriver(run.config.capture.driverId, options);
      const sinkDriver = yield* resolveSinkDriver(run.config.sink.driverId, options);

      const captureConfig = yield* captureDriver.validate(run.config.capture.config);
      const sinkConfig = yield* sinkDriver.validate(run.config.sink.config);

      const attachment = yield* sinkDriver.attach(sinkConfig);
      if (attachment.control !== undefined) {
        yield* bus.mountSurface(attachment.control);
      }

      const sinkInstanceId = run.config.sink.instanceId ?? "file-export";
      const sinks: Record<string, SinkStageState> = {
        [sinkInstanceId]: {
          attachment,
          finalized: false,
          deliveredItems: 0,
          drainedTracks: {}
        }
      };

      const boardWake = yield* createWorkerBoardWake();
      yield* bus.registerWakeWorker(() => boardWake.notify());

      const marketSetup = yield* resolveMarketRegistrarFromOptions(options.market);
      if (marketSetup !== undefined) {
        yield* forkMarketRegistrationIfNeeded({
          runId: run.config.runId,
          bus,
          registration: marketSetup.registration,
          registrar: marketSetup.registrar
        });
      }

      const result = yield* runScopedWorkerUntilStoppedWithBoard({
        runId: run.config.runId,
        manifest: run.manifest,
        sinks,
        bus,
        boardWake,
        maxTurns: options.maxTurns ?? defaultObserveRunMaxTurns,
        prepareCapture: captureDriver.create(captureConfig)
      });

      const board = applyWorkerSnapshotToBoard(yield* bus.readBoard(), result.snapshot);
      yield* bus.commitBoard(board);

      return {
        outcome: result.outcome,
        board,
        snapshot: result.snapshot,
        outputUri: readOutputUri(result.snapshot, sinkInstanceId)
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

    const fiber = yield* Effect.forkScoped(startObserveRun(run, options ?? {}));
    let interrupted = false;

    const handle: ObserveRunHandle = {
      runId: run.config.runId,
      run,
      bus: run.bus,
      startedAtMs: Date.now(),
      awaitResult: () => Fiber.join(fiber),
      interrupt: Effect.gen(function* () {
        if (interrupted) {
          return;
        }

        interrupted = true;
        yield* Fiber.interrupt(fiber);
      })
    };

    return handle;
  });

export const defaultStopTimeoutMs = 5000;

export interface StopRunOptions {
  readonly reason?: string;
  readonly timeoutMs?: number;
}

export const stopObserveRun = (
  store: RunStore,
  runId: string,
  options?: StopRunOptions
): Effect.Effect<ObserveRunResult, LiveStreakError> =>
  Effect.gen(function* () {
    const handle = yield* store.requireHandle(runId);
    const timeoutMs = yield* validateStopTimeoutMs(options?.timeoutMs);

    yield* callStoredRunFunction(store, {
      callId: `stop-${runId}`,
      runId,
      scope: systemRunStopScope,
      ...(options?.reason === undefined ? {} : { payload: { reason: options.reason } })
    });

    const raced = yield* Effect.race(
      handle.awaitResult().pipe(Effect.map((result) => ({ tag: "completed" as const, result }))),
      Effect.sleep(`${timeoutMs} millis`).pipe(Effect.map(() => ({ tag: "timeout" as const })))
    );

    if (raced.tag === "completed") {
      return raced.result;
    }

    yield* handle.interrupt;

    const afterInterrupt = yield* Effect.exit(handle.awaitResult());
    if (Exit.isSuccess(afterInterrupt)) {
      return afterInterrupt.value;
    }

    return yield* buildInterruptedStopResult(handle, timeoutMs);
  });

// --- helpers ---

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

  if (captureDriverId === "file") {
    return Effect.succeed(getBuiltInCaptureDriver("file"));
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

const buildInterruptedStopResult = (
  handle: ObserveRunHandle,
  timeoutMs: number
): Effect.Effect<ObserveRunResult, LiveStreakError> =>
  Effect.gen(function* () {
    const message = `Stop timed out after ${timeoutMs}ms; worker interrupted`;
    const currentBoard = yield* handle.bus.readBoard();
    yield* handle.bus.commitBoard(setBoardRunStatus(currentBoard, "failed", message));
    const board = yield* handle.bus.readBoard();

    return {
      outcome: "interrupted",
      board
    };
  });

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
