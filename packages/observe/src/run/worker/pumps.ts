import { Effect } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import type { WorkerControlView } from "#run/control/board/index.js";
import type { RawFrame } from "#pipeline/capture/index.js";
import type { MarkerSinkDeliveryItem, VideoSinkDeliveryItem } from "#pipeline/publish/index.js";
import {
  appendEosMarker,
  appendTrackItem,
  CAPTURE_VIDEO_RAW_TRACK_ID,
  commitTrackCursor,
  failWorker,
  nextTrackSequence,
  readTrackItem,
  resolveManifestSourceTrackId,
  type TrackItem,
  type WorkerState
} from "./state.js";
import { shouldPumpCapture, shouldPumpSinks } from "./lifecycle.js";

export interface PumpResult {
  readonly didWork: boolean;
}

export const pumpCapture = (
  state: WorkerState,
  control: WorkerControlView
): Effect.Effect<PumpResult, LiveStreakError> => {
  if (shouldPumpCapture(state, control) === false) {
    return Effect.succeed({ didWork: false });
  }

  const capture = state.capture;
  if (capture === undefined) {
    return Effect.succeed({ didWork: false });
  }

  if (capture.eosAppended) {
    return Effect.succeed({ didWork: false });
  }

  if (capture.exhausted) {
    if (capture.eosAppended === false) {
      appendEosMarker(state, CAPTURE_VIDEO_RAW_TRACK_ID);
      capture.eosAppended = true;
      return Effect.succeed({ didWork: true });
    }
    return Effect.succeed({ didWork: false });
  }

  return Effect.gen(function* () {
    const frame = yield* capture.pull.pullNext();

    if (frame === undefined) {
      capture.exhausted = true;
      appendEosMarker(state, CAPTURE_VIDEO_RAW_TRACK_ID);
      capture.eosAppended = true;
      return { didWork: true };
    }

    const item = rawFrameToTrackItem(state, frame);
    appendTrackItem(state, item);
    return { didWork: true };
  });
};

export const pumpProcess = (
  _state: WorkerState,
  control: WorkerControlView
): Effect.Effect<PumpResult, LiveStreakError> => {
  if (control.process === null) {
    return Effect.succeed({ didWork: false });
  }

  return Effect.succeed({ didWork: false });
};

export const pumpSinks = (
  state: WorkerState,
  control: WorkerControlView
): Effect.Effect<PumpResult, LiveStreakError> => {
  if (shouldPumpSinks(state.lifecycle) === false) {
    return Effect.succeed({ didWork: false });
  }

  return Effect.gen(function* () {
    let didWork = false;

    for (const sinkPolicy of control.sinks) {
      const sinkState = state.sinks[sinkPolicy.sinkId];
      if (sinkState === undefined) {
        continue;
      }

      if (sinkState.finalized) {
        continue;
      }

      for (const publishTrackId of sinkPolicy.subscribe) {
        const sourceTrackId = resolveManifestSourceTrackId(state.manifest, publishTrackId);
        if (sourceTrackId === undefined) {
          failWorker(
            state,
            `Sink ${sinkPolicy.sinkId} subscribed to unknown manifest track ${publishTrackId}`
          );
          continue;
        }

        if (state.tracks[sourceTrackId] === undefined) {
          failWorker(state, `Manifest source track ${sourceTrackId} is missing from worker state`);
          continue;
        }

        const cursorId = sinkCursorId(sinkPolicy.sinkId, publishTrackId);
        const item = readTrackItem(state, sourceTrackId, cursorId);
        if (item === undefined) {
          continue;
        }

        if (item.kind === "marker") {
          if (item.marker.kind === "eos") {
            sinkState.drainedTracks[publishTrackId] = true;
          }

          const deliveryItem = markerTrackItemToSinkDelivery(
            sinkPolicy.sinkId,
            publishTrackId,
            item
          );
          yield* sinkState.attachment.deliver(deliveryItem);
          commitTrackCursor(state, sourceTrackId, cursorId);
          didWork = true;
          continue;
        }

        const deliveryItem = videoTrackItemToSinkDelivery(
          sinkPolicy.sinkId,
          publishTrackId,
          item
        );

        yield* sinkState.attachment.deliver(deliveryItem);
        sinkState.deliveredItems += 1;
        commitTrackCursor(state, sourceTrackId, cursorId);
        didWork = true;
      }
    }

    return { didWork };
  });
};

export const finalizeSinks = (
  state: WorkerState,
  control: WorkerControlView
): Effect.Effect<PumpResult, LiveStreakError> => {
  if (state.lifecycle !== "draining") {
    return Effect.succeed({ didWork: false });
  }
  return Effect.gen(function* () {
    let didWork = false;

    for (const sinkPolicy of control.sinks) {
      const sinkState = state.sinks[sinkPolicy.sinkId];
      if (sinkState === undefined) {
        continue;
      }

      if (sinkState.finalized) {
        continue;
      }

      if (sinkIsReadyToFinalize(state, control, sinkPolicy.sinkId) === false) {
        continue;
      }

      const finalizeResult = yield* sinkState.attachment.finalize;
      sinkState.finalized = true;
      sinkState.finalizeResult = finalizeResult;
      didWork = true;
    }

    return { didWork };
  });
};

export const sinkIsReadyToFinalize = (
  state: WorkerState,
  control: WorkerControlView,
  sinkId: string
): boolean => {
  const sinkState = state.sinks[sinkId];
  if (sinkState === undefined) {
    return false;
  }

  const sinkPolicy = control.sinks.find((entry) => entry.sinkId === sinkId);
  if (sinkPolicy === undefined) {
    return false;
  }

  for (const publishTrackId of sinkPolicy.subscribe) {
    if (sinkState.drainedTracks[publishTrackId] !== true) {
      return false;
    }
  }

  return true;
};

// --- helpers ---

const sinkCursorId = (sinkId: string, publishTrackId: string): string =>
  `sink:${sinkId}:${publishTrackId}`;

const rawFrameToTrackItem = (state: WorkerState, frame: RawFrame): TrackItem => {
  const sequence = nextTrackSequence(state, CAPTURE_VIDEO_RAW_TRACK_ID);
  let mediaTimeMs = sequence * 33;
  if (frame.time.mediaTimeMs !== undefined) {
    mediaTimeMs = frame.time.mediaTimeMs;
  }

  return {
    trackId: CAPTURE_VIDEO_RAW_TRACK_ID,
    sequence,
    epoch: state.epoch,
    mediaTimeMs,
    wallTimeMs: frame.time.wallClockMs,
    kind: "video",
    payloadBytes: frame.payload.data.byteLength,
    payload: frame.payload
  };
};

const videoTrackItemToSinkDelivery = (
  sinkId: string,
  publishTrackId: string,
  item: Extract<TrackItem, { kind: "video" }>
): VideoSinkDeliveryItem => ({
  kind: "video",
  sinkId,
  trackId: publishTrackId,
  role: publishTrackId,
  sequence: item.sequence,
  epoch: item.epoch,
  mediaTimeMs: item.mediaTimeMs,
  wallTimeMs: item.wallTimeMs,
  payloadBytes: item.payloadBytes,
  payload: item.payload
});

const markerTrackItemToSinkDelivery = (
  sinkId: string,
  publishTrackId: string,
  item: Extract<TrackItem, { kind: "marker" }>
): MarkerSinkDeliveryItem => ({
  kind: "marker",
  sinkId,
  trackId: publishTrackId,
  role: publishTrackId,
  sequence: item.sequence,
  epoch: item.epoch,
  wallTimeMs: item.wallTimeMs,
  ...(item.mediaTimeMs === undefined ? {} : { mediaTimeMs: item.mediaTimeMs }),
  marker: item.marker
});
