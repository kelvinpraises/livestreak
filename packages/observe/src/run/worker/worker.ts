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

const defaultMaxTurns = 512;

const resolveMaxTurns = (maxTurns: number | undefined): number => {
  if (maxTurns === undefined) {
    return defaultMaxTurns;
  }
  return maxTurns;
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

    const maxTurns = resolveMaxTurns(input.maxTurns);
    let turns = 0;
    const state = input.state;

    if (state.lifecycle === "idle") {
      state.lifecycle = "running";
    }

    while (turns < maxTurns) {
      const board = yield* input.bus.readBoard();
      const view = projectWorkerControlView(board);
      const turn = yield* supervisorTurn(state, view);
      turns += 1;

      if (input.afterTurn === true) {
        const latestBoard = yield* input.bus.readBoard();
        const snapshot = projectWorkerSnapshot(state);
        yield* input.bus.commitBoard(applyWorkerSnapshotToBoard(latestBoard, snapshot));
      }

      if (turn.shouldContinue === false) {
        break;
      }

      if (shouldWaitForControl(state)) {
        yield* input.boardWake.waitForWake();
        continue;
      }

      yield* Effect.yieldNow();
    }

    const outcome = resolveWorkerRunOutcome(state, turns, maxTurns);

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
  turns: number,
  maxTurns: number
): WorkerRunOutcome => {
  if (state.lifecycle === "stopped") {
    return "stopped";
  }

  if (state.lifecycle === "failed") {
    return "failed";
  }

  if (turns >= maxTurns && (activeWorkerLifecycles as readonly string[]).includes(state.lifecycle)) {
    failWorker(state, `Worker exceeded maxTurns while ${state.lifecycle}`);
    return "max-turns-exceeded";
  }

  failWorker(state, "Worker loop ended before reaching stopped");
  return "failed";
};

const shouldWaitForControl = (state: WorkerState): boolean => state.lifecycle === "paused";
