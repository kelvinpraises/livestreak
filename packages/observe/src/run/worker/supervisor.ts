import { Effect } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import type { WorkerControlView } from "#run/control/board/index.js";
import {
  advanceStoppingToDraining,
  beginPauseCycleIfNeeded,
  completePauseAfterSourcePaused,
  completeResumeIfNeeded,
  ensureIdleBecomesRunning,
  promotePauseIfRequested,
  promoteResumeIfRequested,
  promoteStopIfRequested,
  reconcilePauseLiveControls,
  shouldPumpCapture
} from "./lifecycle.js";
import { applySinkPausePresentation } from "./sink-presentation.js";
import {
  CAPTURE_VIDEO_RAW_TRACK_ID,
  refreshCaptureStageHealth,
  trackHasMarkerKind,
  type WorkerLifecycle,
  type WorkerState
} from "./state.js";
import { finalizeSinks, pumpCapture, pumpProcess, pumpSinks } from "./pumps.js";

export interface SupervisorTurnResult {
  readonly lifecycle: WorkerLifecycle;
  readonly shouldContinue: boolean;
  readonly didWork: boolean;
}

export const supervisorTurn = (
  state: WorkerState,
  control: WorkerControlView
): Effect.Effect<SupervisorTurnResult, LiveStreakError> => {
  return Effect.gen(function* () {
    state.lastAppliedControlRevision = control.revision;

    ensureIdleBecomesRunning(state);
    promoteStopIfRequested(state, control);

    if (state.lifecycle === "stopped") {
      return yield* completeSupervisorTurn(state, {
        lifecycle: state.lifecycle,
        shouldContinue: false,
        didWork: false
      });
    }

    if (state.lifecycle === "failed") {
      return yield* completeSupervisorTurn(state, {
        lifecycle: state.lifecycle,
        shouldContinue: false,
        didWork: false
      });
    }

    promotePauseIfRequested(state, control);
    promoteResumeIfRequested(state, control);

    if (state.lifecycle === "stopping") {
      return yield* turnStopping(state, control);
    }

    if (state.lifecycle === "draining") {
      return yield* turnDraining(state, control);
    }

    if (state.lifecycle === "running") {
      return yield* turnRunning(state, control);
    }

    if (state.lifecycle === "pausing") {
      return yield* turnPausing(state, control);
    }

    if (state.lifecycle === "paused") {
      return yield* turnPaused(state, control);
    }

    if (state.lifecycle === "resuming") {
      return yield* turnResuming(state, control);
    }

    return yield* completeSupervisorTurn(state, {
      lifecycle: state.lifecycle,
      shouldContinue: true,
      didWork: false
    });
  });
};

// --- helpers ---

const turnRunning = (
  state: WorkerState,
  control: WorkerControlView
): Effect.Effect<SupervisorTurnResult, LiveStreakError> =>
  Effect.gen(function* () {
    if (shouldPumpCapture(state, control) === false) {
      return yield* completeSupervisorTurn(state, {
        lifecycle: state.lifecycle,
        shouldContinue: true,
        didWork: false
      });
    }

    const capture = yield* pumpCapture(state, control);
    if (workerTurnFailed(state)) {
      return yield* completeSupervisorTurn(state, {
        lifecycle: state.lifecycle,
        shouldContinue: false,
        didWork: capture.didWork
      });
    }

    const process = yield* pumpProcess(state, control);
    if (workerTurnFailed(state)) {
      return yield* completeSupervisorTurn(state, {
        lifecycle: state.lifecycle,
        shouldContinue: false,
        didWork: capture.didWork || process.didWork
      });
    }

    const sinks = yield* pumpSinks(state, control);
    if (workerTurnFailed(state)) {
      return yield* completeSupervisorTurn(state, {
        lifecycle: state.lifecycle,
        shouldContinue: false,
        didWork: capture.didWork || process.didWork || sinks.didWork
      });
    }

    const didWork = capture.didWork || process.didWork || sinks.didWork;

    if (shouldEnterNaturalDraining(state, control)) {
      state.lifecycle = "draining";
    }

    return yield* completeSupervisorTurn(state, {
      lifecycle: state.lifecycle,
      shouldContinue: true,
      didWork
    });
  });

const turnPausing = (
  state: WorkerState,
  control: WorkerControlView
): Effect.Effect<SupervisorTurnResult, LiveStreakError> =>
  Effect.gen(function* () {
    const didWork = beginPauseCycleIfNeeded(state, control);

    yield* reconcilePauseLiveControls(state, control);
    if (workerTurnFailed(state)) {
      return yield* completeSupervisorTurn(state, {
        lifecycle: state.lifecycle,
        shouldContinue: false,
        didWork
      });
    }

    yield* applySinkPausePresentation(state, control);
    if (workerTurnFailed(state)) {
      return yield* completeSupervisorTurn(state, {
        lifecycle: state.lifecycle,
        shouldContinue: false,
        didWork
      });
    }

    completePauseAfterSourcePaused(state);

    return yield* completeSupervisorTurn(state, {
      lifecycle: state.lifecycle,
      shouldContinue: true,
      didWork
    });
  });

const turnPaused = (
  state: WorkerState,
  control: WorkerControlView
): Effect.Effect<SupervisorTurnResult, LiveStreakError> =>
  Effect.gen(function* () {
    if (control.pause.requested) {
      yield* reconcilePauseLiveControls(state, control);
    }

    return yield* completeSupervisorTurn(state, {
      lifecycle: state.lifecycle,
      shouldContinue: true,
      didWork: false
    });
  });

const turnResuming = (
  state: WorkerState,
  control: WorkerControlView
): Effect.Effect<SupervisorTurnResult, LiveStreakError> =>
  Effect.gen(function* () {
    const didWork = yield* completeResumeIfNeeded(state, control);
    if (workerTurnFailed(state)) {
      return yield* completeSupervisorTurn(state, {
        lifecycle: state.lifecycle,
        shouldContinue: false,
        didWork
      });
    }

    return yield* completeSupervisorTurn(state, {
      lifecycle: state.lifecycle,
      shouldContinue: true,
      didWork
    });
  });

const turnStopping = (
  state: WorkerState,
  control: WorkerControlView
): Effect.Effect<SupervisorTurnResult, LiveStreakError> =>
  Effect.gen(function* () {
    advanceStoppingToDraining(state);

    const sinks = yield* pumpSinks(state, control);
    if (workerTurnFailed(state)) {
      return yield* completeSupervisorTurn(state, {
        lifecycle: state.lifecycle,
        shouldContinue: false,
        didWork: sinks.didWork
      });
    }

    return yield* completeSupervisorTurn(state, {
      lifecycle: state.lifecycle,
      shouldContinue: true,
      didWork: sinks.didWork
    });
  });

const turnDraining = (
  state: WorkerState,
  control: WorkerControlView
): Effect.Effect<SupervisorTurnResult, LiveStreakError> =>
  Effect.gen(function* () {
    const sinks = yield* pumpSinks(state, control);
    if (workerTurnFailed(state)) {
      return yield* completeSupervisorTurn(state, {
        lifecycle: state.lifecycle,
        shouldContinue: false,
        didWork: sinks.didWork
      });
    }

    const finalize = yield* finalizeSinks(state, control);
    if (workerTurnFailed(state)) {
      return yield* completeSupervisorTurn(state, {
        lifecycle: state.lifecycle,
        shouldContinue: false,
        didWork: sinks.didWork || finalize.didWork
      });
    }

    const didWork = sinks.didWork || finalize.didWork;

    if (allSinksFinalized(state, control)) {
      state.lifecycle = "stopped";
      return yield* completeSupervisorTurn(state, {
        lifecycle: state.lifecycle,
        shouldContinue: false,
        didWork
      });
    }

    return yield* completeSupervisorTurn(state, {
      lifecycle: state.lifecycle,
      shouldContinue: true,
      didWork
    });
  });

const completeSupervisorTurn = (
  state: WorkerState,
  result: SupervisorTurnResult
): Effect.Effect<SupervisorTurnResult, LiveStreakError> => {
  return Effect.gen(function* () {
    yield* refreshCaptureStageHealth(state);

    if (state.lifecycle === "failed") {
      return {
        lifecycle: state.lifecycle,
        shouldContinue: false,
        didWork: result.didWork
      };
    }

    return result;
  });
};

const allSinksFinalized = (state: WorkerState, control: WorkerControlView): boolean => {
  for (const sinkPolicy of control.sinks) {
    const sinkState = state.sinks[sinkPolicy.sinkId];
    if (sinkState === undefined) {
      return false;
    }

    if (sinkState.finalized === false) {
      return false;
    }
  }

  return true;
};

const workerTurnFailed = (state: WorkerState): boolean => state.lifecycle === "failed";

const shouldEnterNaturalDraining = (state: WorkerState, control: WorkerControlView): boolean => {
  if (control.run.stopRequested) {
    return false;
  }

  if (control.process !== null) {
    return false;
  }

  return trackHasMarkerKind(state, CAPTURE_VIDEO_RAW_TRACK_ID, "eos");
};
