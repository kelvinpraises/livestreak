import { Effect } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import type { WorkerControlView } from "#run/control/board/index.js";
import { failWorker, type WorkerState } from "./state.js";
import type { CaptureLivePauseStageState } from "./capture-pull.js";

export const reconcileLivePause = (
  state: WorkerState,
  control: WorkerControlView
): Effect.Effect<void, LiveStreakError> => {
  if (control.run.stopRequested) {
    return Effect.void;
  }

  const livePause = state.capture?.livePause;
  if (livePause === undefined) {
    return Effect.void;
  }

  return Effect.gen(function* () {
    if (control.pause.requested) {
      if (!livePause.paused) {
        yield* applyLivePause(livePause, control.revision, state);
      }
      return;
    }

    if (livePause.paused) {
      yield* applyLiveResume(livePause, control.revision, state);
    }
  });
};

export const reconcileLiveResume = (
  state: WorkerState,
  control: WorkerControlView
): Effect.Effect<void, LiveStreakError> => {
  if (control.run.stopRequested) {
    return Effect.void;
  }

  const livePause = state.capture?.livePause;
  if (livePause === undefined || !livePause.paused) {
    return Effect.void;
  }

  return applyLiveResume(livePause, control.revision, state);
};

const applyLivePause = (
  livePause: CaptureLivePauseStageState,
  boardRevision: number,
  state: WorkerState
): Effect.Effect<void, LiveStreakError> =>
  livePause.controls.pause().pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        livePause.paused = true;
        livePause.appliedBoardRevision = boardRevision;
      })
    ),
    Effect.asVoid,
    Effect.catchAll((error) => {
      failWorker(state, livePauseErrorMessage(error, "pause"));
      return Effect.void;
    })
  );

const applyLiveResume = (
  livePause: CaptureLivePauseStageState,
  boardRevision: number,
  state: WorkerState
): Effect.Effect<void, LiveStreakError> =>
  livePause.controls.resume().pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        livePause.paused = false;
        livePause.appliedBoardRevision = boardRevision;
      })
    ),
    Effect.asVoid,
    Effect.catchAll((error) => {
      failWorker(state, livePauseErrorMessage(error, "resume"));
      return Effect.void;
    })
  );

const livePauseErrorMessage = (
  error: LiveStreakError,
  action: "pause" | "resume"
): string => {
  if ("message" in error && typeof error.message === "string") {
    return `Live ${action} failed: ${error.message}`;
  }

  return `Live ${action} failed`;
};
