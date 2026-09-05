import { Effect, Scope } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import type { FrameSource } from "#pipeline/capture/index.js";
import { applyWorkerSnapshotToBoard } from "#run/control/board/index.js";
import { projectWorkerControlView } from "#run/control/board/index.js";
import type { ControlBus } from "#run/control/bus/index.js";
import { createCaptureStageState, createEmptyWorkerState, failWorker, type PublishManifest, type SinkStageState } from "./state.js";
import { validateWorkerPrepare } from "./prepare.js";
import { supervisorTurn } from "./supervisor.js";
import { projectWorkerSnapshot, type WorkerSnapshot } from "./snapshot.js";
import type { WorkerState } from "./state.js";
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
}

export interface RunScopedWorkerUntilStoppedInput {
  readonly runId: string;
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
      afterTurn: true
    });

    const board = yield* input.bus.readBoard();
    const snapshot = projectWorkerSnapshot(loop.state);
    yield* input.bus.commitBoard(applyWorkerSnapshotToBoard(board, snapshot));

    return loop.result;
  });
};

export const runScopedWorkerUntilStoppedWithBoard = (
  input: RunScopedWorkerUntilStoppedInput
): Effect.Effect<WorkerRunWithBoardResult, LiveStreakError, Scope.Scope> => {
  return Effect.gen(function* () {
    const source = yield* input.prepareCapture;

    if (source.control !== undefined) {
      yield* input.bus.mountSurface(source.control);
    }

    const capture = yield* createCaptureStageState(source);
    const state = createEmptyWorkerState({
      runId: input.runId,
      manifest: input.manifest,
      capture,
      sinks: input.sinks
    });

    return yield* runWorkerUntilStoppedWithBoard({
      state,
      bus: input.bus,
      boardWake: input.boardWake,
      maxTurns: input.maxTurns
    });
  });
};

// --- helpers ---

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
    yield* validateWorkerPrepare(input.state, projectWorkerControlView(initialBoard));

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
      const view = projectWorkerControlView(board);
      const turn = yield* supervisorTurn(state, view);
      turns += 1;

      // O1: only no-progress turns count against the budget; any work resets it.
      if (turn.didWork === true) {
        consecutiveIdleTurns = 0;
      } else {
        consecutiveIdleTurns += 1;
      }

      if (input.afterTurn === true) {
        const latestBoard = yield* input.bus.readBoard();
        const snapshot = projectWorkerSnapshot(state);
        yield* input.bus.commitBoard(applyWorkerSnapshotToBoard(latestBoard, snapshot));
      }

      if (turn.shouldContinue === false) {
        break;
      }

      if (consecutiveIdleTurns >= maxIdleTurns) {
        stalled = true;
        break;
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
