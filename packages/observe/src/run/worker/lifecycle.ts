import { Effect } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import type { WorkerControlView } from "#run/control/board/index.js";
import {
  appendPauseEndMarker,
  appendPauseStartMarker,
  appendPresentationSlateMarker,
  type TimelineMarkerPayload
} from "./timeline.js";
import {
  CAPTURE_VIDEO_RAW_TRACK_ID,
  ensureCaptureEndForStop,
  type WorkerLifecycle,
  type WorkerState
} from "./state.js";
import { reconcileLivePause, reconcileLiveResume } from "./live-pause.js";
import { resumeSinkPresentation } from "./sink-presentation.js";

export const ensureIdleBecomesRunning = (state: WorkerState): void => {
  if (state.lifecycle === "idle") {
    state.lifecycle = "running";
  }
};

export const promoteStopIfRequested = (state: WorkerState, control: WorkerControlView): void => {
  if (control.run.stopRequested === false) {
    return;
  }

  if (state.lifecycle === "draining" || state.lifecycle === "stopping") {
    return;
  }

  const stoppableLifecycles: readonly WorkerLifecycle[] = [
    "running",
    "pausing",
    "paused",
    "resuming"
  ];

  if (stoppableLifecycles.includes(state.lifecycle)) {
    state.lifecycle = "stopping";
  }
};

export const shouldPumpCapture = (state: WorkerState, control: WorkerControlView): boolean =>
  state.lifecycle === "running" &&
  control.pause.requested === false &&
  control.run.stopRequested === false;

export const shouldPumpSinks = (lifecycle: WorkerLifecycle): boolean =>
  (["running", "stopping", "draining"] as readonly WorkerLifecycle[]).includes(lifecycle);

export const beginPauseCycleIfNeeded = (
  state: WorkerState,
  control: WorkerControlView
): boolean => {
  if (state.pauseCycle?.started === true) {
    return false;
  }

  const payload = markerPayload(state, control);

  appendPauseStartMarker(state, CAPTURE_VIDEO_RAW_TRACK_ID, payload);

  let presentationMarkerAppended = false;
  if (control.pause.whilePaused === "slate") {
    appendPresentationSlateMarker(state, CAPTURE_VIDEO_RAW_TRACK_ID, {
      ...payload,
      slateAssetId: control.pause.slateAssetId
    });
    presentationMarkerAppended = true;
  }

  state.pauseCycle = {
    started: true,
    presentationMarkerAppended
  };

  return true;
};

export const completePauseAfterSourcePaused = (state: WorkerState): void => {
  if (state.lifecycle === "pausing") {
    state.lifecycle = "paused";
  }
};

export const promoteResumeIfRequested = (state: WorkerState, control: WorkerControlView): void => {
  if (state.lifecycle === "paused" && control.pause.requested === false) {
    state.lifecycle = "resuming";
  }
};

export const completeResumeIfNeeded = (
  state: WorkerState,
  control: WorkerControlView
): Effect.Effect<boolean, LiveStreakError> =>
  Effect.gen(function* () {
    if (state.lifecycle !== "resuming") {
      return false;
    }

    yield* resumeSinkPresentation(state, control);
    if ((state.lifecycle as WorkerLifecycle) === "failed") {
      return false;
    }

    yield* reconcileLiveResume(state, control);

    const payload = markerPayload(state, control);
    appendPauseEndMarker(state, CAPTURE_VIDEO_RAW_TRACK_ID, payload);

    state.pauseCycle = undefined;
    state.lifecycle = "running";
    return true;
  });

export const advanceStoppingToDraining = (state: WorkerState): void => {
  if (state.lifecycle !== "stopping") {
    return;
  }

  ensureCaptureEndForStop(state);

  const capture = state.capture;
  if (capture === undefined || capture.eosAppended) {
    state.lifecycle = "draining";
  }
};

export const promotePauseIfRequested = (state: WorkerState, control: WorkerControlView): void => {
  if (state.lifecycle === "running" && control.pause.requested) {
    state.lifecycle = "pausing";
  }
};

export const reconcilePauseLiveControls = (
  state: WorkerState,
  control: WorkerControlView
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    if (state.lifecycle !== "pausing" && state.lifecycle !== "paused") {
      return;
    }

    if (control.pause.requested === false) {
      return;
    }

    yield* reconcileLivePause(state, control);
  });

const markerPayload = (state: WorkerState, control: WorkerControlView): TimelineMarkerPayload => ({
  whilePaused: control.pause.whilePaused,
  epoch: state.epoch,
  ...(control.pause.slateAssetId === undefined
    ? {}
    : { slateAssetId: control.pause.slateAssetId })
});

export type { WorkerPauseCycle } from "./state.js";
