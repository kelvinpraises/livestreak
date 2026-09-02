import { Effect } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import type { SinkPausePresentation } from "#pipeline/publish/index.js";
import type { WorkerControlView } from "#run/control/board/index.js";
import { failWorker, type WorkerLifecycle, type WorkerState } from "./state.js";

export const applySinkPausePresentation = (
  state: WorkerState,
  control: WorkerControlView
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    if (state.pauseCycle?.presentationApplied === true) {
      return;
    }

    if (state.lifecycle !== "pausing" && state.lifecycle !== "paused") {
      return;
    }

    if (control.pause.requested === false) {
      return;
    }

    const presentation = toSinkPausePresentation(control);
    let appliedAny = false;

    for (const sinkState of Object.values(state.sinks)) {
      const hook = sinkState.attachment.presentation;
      if (hook === undefined) {
        continue;
      }

      yield* hook.pausePresentation(presentation).pipe(
        Effect.catchAll((error) => {
          failWorker(state, sinkPresentationErrorMessage(error, "pause"));
          return Effect.void;
        })
      );

      if ((state.lifecycle as WorkerLifecycle) === "failed") {
        return;
      }

      appliedAny = true;
    }

    if (state.pauseCycle !== undefined && appliedAny) {
      state.pauseCycle.presentationApplied = true;
    }
  });

export const resumeSinkPresentation = (
  state: WorkerState,
  control: WorkerControlView
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    if (state.pauseCycle?.presentationApplied !== true) {
      return;
    }

    if (state.pauseCycle.presentationResumed === true) {
      return;
    }

    if (control.run.stopRequested) {
      return;
    }

    for (const sinkState of Object.values(state.sinks)) {
      const hook = sinkState.attachment.presentation;
      if (hook === undefined) {
        continue;
      }

      yield* hook.resumePresentation.pipe(
        Effect.catchAll((error) => {
          failWorker(state, sinkPresentationErrorMessage(error, "resume"));
          return Effect.void;
        })
      );

      if ((state.lifecycle) === "failed") {
        return;
      }
    }

    state.pauseCycle.presentationResumed = true;
  });

const toSinkPausePresentation = (control: WorkerControlView): SinkPausePresentation =>
  control.pause.whilePaused === "slate"
    ? {
        whilePaused: "slate",
        slateAssetId: control.pause.slateAssetId!
      }
    : { whilePaused: "hold" };

const sinkPresentationErrorMessage = (
  error: LiveStreakError,
  action: "pause" | "resume"
): string => {
  if ("message" in error && typeof error.message === "string") {
    return `Sink presentation ${action} failed: ${error.message}`;
  }

  return `Sink presentation ${action} failed`;
};
