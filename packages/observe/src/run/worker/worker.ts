import { Effect, Scope } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import type { FrameSource } from "#pipeline/capture/index.js";
import { applyWorkerSnapshotToBoard } from "#run/control/board/index.js";
import { projectWorkerControlView } from "#run/control/board/index.js";
import type { ControlBus } from "#run/control/bus/index.js";
import type { ExecutionLease } from "#run/control/bus/types.js";
import { createCaptureStageState, createEmptyWorkerState, failWorker, type PublishManifest, type SinkStageState } from "./state.js";
import { validateWorkerPrepare } from "./prepare.js";
import { supervisorTurn } from "./supervisor.js";
import { projectWorkerSnapshot, type WorkerSnapshot } from "./snapshot.js";
import type { WorkerLifecycle, WorkerState } from "./state.js";
import type { WorkerBoardWake } from "./wake.js";

export type WorkerRunOutcome = "stopped" | "failed" | "max-turns-exceeded";

export interface WorkerRunResult {
  readonly state: WorkerState;
  readonly snapshot: WorkerSnapshot;
  readonly turns: number;
  readonly outcome: WorkerRunOutcome;
}

export interface WorkerRunWithBoardResult extends WorkerRunResult {
  readonly snapshot: WorkerSnapshot;
}

export interface RunWorkerUntilStoppedInput {
  readonly state: WorkerState;
  readonly bus: ControlBus;
  readonly boardWake: WorkerBoardWake;
  readonly maxTurns?: number;
  /** Execution lease captured at start; snapshot commits are generation-fenced with it. */
  readonly execution?: ExecutionLease;
}

export interface RunScopedWorkerUntilStoppedInput {
  readonly runId: string;
  readonly obsId?: string;
  /** Execution lease captured at start; snapshot commits are generation-fenced with it. */
  readonly execution?: ExecutionLease;
  readonly manifest: PublishManifest;
  readonly sinks: Record<string, SinkStageState>;
  readonly bus: ControlBus;
  readonly boardWake: WorkerBoardWake;
  readonly prepareCapture: Effect.Effect<FrameSource, LiveStreakError, Scope.Scope>;
  readonly maxTurns?: number;
}

export const runWorkerUntilStopped = (
  input: RunWorkerUntilStoppedInput
): Effect.Effect<WorkerRunResult, LiveStreakError> => {
  return Effect.gen(function* () {
    const loop = yield* runWorkerLoop({
      state: input.state,
      bus: input.bus,
      boardWake: input.boardWake,
      maxTurns: input.maxTurns
    });
    return loop.result;
  });
};

export const runWorkerUntilStoppedWithBoard = (
  input: RunWorkerUntilStoppedInput
): Effect.Effect<WorkerRunWithBoardResult, LiveStreakError> => {
  return Effect.gen(function* () {
    const loop = yield* runWorkerLoop({
      state: input.state,
      bus: input.bus,
      boardWake: input.boardWake,
      maxTurns: input.maxTurns,
      afterTurn: true,
      ...(input.execution === undefined ? {} : { execution: input.execution })
    });

    const snapshot = projectWorkerSnapshot(loop.state);
    yield* commitWorkerSnapshotBoard(input.bus, snapshot, input.state.obsId, input.execution);

    return loop.result;
  });
};

export const runScopedWorkerUntilStoppedWithBoard = (
  input: RunScopedWorkerUntilStoppedInput
): Effect.Effect<WorkerRunWithBoardResult, LiveStreakError, Scope.Scope> => {
  return Effect.gen(function* () {
    const source = yield* input.prepareCapture;

    if (source.control !== undefined) {
      if (input.obsId === undefined) {
        yield* input.bus.mountSurface(source.control);
      } else {
        // Owned binding: a family never mints a global stage cell for its source control.
        // Family functions are preserved; control-specific routing uses the validated
        // canonical route, and result footprints are enforced at commit.
        const ownerId = `obs:${input.obsId}:capture`;
        const owner = (yield* input.bus.readBoard()).cells[ownerId];
        if (owner !== undefined) {
          yield* input.bus.mountStageCell({
            id: ownerId,
            cell: { ...source.control.cell.cell, functions: [...owner.functions] }
          });
        }
      }
    }

    const capture = yield* createCaptureStageState(source);
    const state = createEmptyWorkerState({
      runId: input.runId,
      ...(input.obsId === undefined ? {} : { obsId: input.obsId }),
      manifest: input.manifest,
      capture,
      sinks: input.sinks
    });

    return yield* runWorkerUntilStoppedWithBoard({
      state,
      bus: input.bus,
      boardWake: input.boardWake,
      maxTurns: input.maxTurns,
      ...(input.execution === undefined ? {} : { execution: input.execution })
    });
  });
};

// --- helpers ---

/**
 * Worker snapshot write: when the worker carries its start generation, the write is fenced —
 * a stale generation (stopped/restarted/removed observation) is rejected instead of
 * overwriting current board state. Workers without a lease keep the legacy unchecked write.
 */
const commitWorkerSnapshotBoard = (
  bus: ControlBus,
  snapshot: WorkerSnapshot,
  obsId: string | undefined,
  execution: ExecutionLease | undefined
): Effect.Effect<void, LiveStreakError> => {
  // The projection derives from the CURRENT board inside the guard: two sibling snapshots
  // can never silently drop each other, and a retired generation's write is rejected.
  // Workers without a lease keep the legacy direct commit.
  if (execution === undefined) {
    return bus
      .readBoard()
      .pipe(
        Effect.flatMap((board) => bus.commitBoard(applyWorkerSnapshotToBoard(board, snapshot, obsId))),
        Effect.asVoid
      );
  }
  return bus
    .commitGuardedUpdate({ kind: "owner", lease: execution }, { kind: "snapshot", ...(obsId === undefined ? {} : { obsId }) }, (current) =>
      Effect.succeed(applyWorkerSnapshotToBoard(current, snapshot, obsId))
    )
    .pipe(Effect.asVoid);
}

// O1: the worker budget counts CONSECUTIVE no-progress ("idle") turns, NOT raw
// frame turns. This makes the cap a measure of *liveness* (a stuck loop) rather
// than content length, so long files and unbounded live capture are never killed
// by the budget while a genuinely stalled run still terminates. The `maxTurns`
// input is reinterpreted as this idle-turn budget (callers — incl. the kernel —
// keep passing the same field; no signature change).
const defaultMaxIdleTurns = 512;

const resolveMaxIdleTurns = (maxIdleTurns: number | undefined): number => {
  if (maxIdleTurns === undefined) {
    return defaultMaxIdleTurns;
  }
  return maxIdleTurns;
};

interface WorkerLoopInput {
  readonly state: WorkerState;
  readonly bus: ControlBus;
  readonly boardWake: WorkerBoardWake;
  readonly maxTurns?: number;
  readonly afterTurn?: boolean;
  readonly execution?: ExecutionLease;
}

interface WorkerLoopOutcome {
  readonly state: WorkerState;
  readonly result: WorkerRunResult;
}

const runWorkerLoop = (
  input: WorkerLoopInput
): Effect.Effect<WorkerLoopOutcome, LiveStreakError> => {
  return Effect.gen(function* () {
    const initialBoard = yield* input.bus.readBoard();
    yield* validateWorkerPrepare(input.state, projectWorkerControlView(initialBoard, input.state.obsId));

    const maxIdleTurns = resolveMaxIdleTurns(input.maxTurns);
    let turns = 0;
    let consecutiveIdleTurns = 0;
    let stalled = false;
    const state = input.state;

    if (state.lifecycle === "idle") {
      state.lifecycle = "running";
    }

    while (true) {
      const board = yield* input.bus.readBoard();
      const view = projectWorkerControlView(board, input.state.obsId);
      const prevLifecycle: WorkerLifecycle = state.lifecycle;
      const turn = yield* supervisorTurn(state, view, input.boardWake);
      turns += 1;

      // O1 (+ foundation wake rule): only no-progress turns count against the budget; any
      // work resets it. A capture-control wake is a legitimate wait — neither media work nor
      // spinning — so it neither increments the idle budget nor spends the 5ms wait below.
      // A stable paused lifecycle is equally legitimate: the pump is suspended by design and
      // only control transitions (which publish) can move it. Transients keep counting so a
      // genuinely stuck pause/resume/stop still trips the budget.
      if (turn.didWork === true) {
        consecutiveIdleTurns = 0;
      } else if (turn.wokeForControl !== true && state.lifecycle !== "paused") {
        consecutiveIdleTurns += 1;
      }

      // Publish snapshots on actual work, lifecycle transition, or terminal/error result only.
      // Health-only snapshots from unchanged paused/no-progress turns used to bump the board
      // revision (health timestamps), waking the worker against itself until the idle budget died.
      if (
        input.afterTurn === true &&
        (turn.didWork || state.lifecycle !== prevLifecycle || turn.shouldContinue === false)
      ) {
        const snapshot = projectWorkerSnapshot(state);
        yield* commitWorkerSnapshotBoard(input.bus, snapshot, input.state.obsId, input.execution);
      }

      if (turn.shouldContinue === false) {
        break;
      }

      if (consecutiveIdleTurns >= maxIdleTurns) {
        stalled = true;
        break;
      }

      // A control wake already means "reread the board now": continue immediately without
      // spending another wait first.
      if (turn.wokeForControl === true) {
        continue;
      }

      if (shouldWaitForControl(state)) {
        yield* input.boardWake.waitForWake();
        continue;
      }

      // O6: on a no-progress turn, stop hot-spinning. Wait on the board wake
      // (instant control response) raced with a short sleep (bounds drain latency
      // and keeps a live source between frames cheap). A progress turn yields.
      if (turn.didWork === false) {
        yield* Effect.race(input.boardWake.waitForWake(), Effect.sleep("5 millis"));
        continue;
      }

      yield* Effect.yieldNow();
    }

    const outcome = resolveWorkerRunOutcome(state, stalled);

    return {
      state,
      result: {
        state,
        snapshot: projectWorkerSnapshot(state),
        turns,
        outcome
      }
    };
  });
};

const activeWorkerLifecycles = [
  "running",
  "pausing",
  "paused",
  "resuming",
  "stopping",
  "draining"
] as const;

const resolveWorkerRunOutcome = (
  state: WorkerState,
  stalled: boolean
): WorkerRunOutcome => {
  if (state.lifecycle === "stopped") {
    return "stopped";
  }

  if (state.lifecycle === "failed") {
    return "failed";
  }

  if (stalled && (activeWorkerLifecycles as readonly string[]).includes(state.lifecycle)) {
    failWorker(state, `Worker stalled: no progress for the idle-turn budget while ${state.lifecycle}`);
    return "max-turns-exceeded";
  }

  failWorker(state, "Worker loop ended before reaching stopped");
  return "failed";
};

const shouldWaitForControl = (state: WorkerState): boolean => state.lifecycle === "paused";
