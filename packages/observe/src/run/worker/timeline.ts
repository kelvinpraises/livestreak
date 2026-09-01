import type { TimelineMarker, TimelineMarkerKind } from "#pipeline/timeline/index.js";
import {
  appendTrackItem,
  nextTrackSequence,
  readLastMediaTimeMs,
  type WorkerState
} from "./state.js";

export type {
  TimelineMarker,
  TimelineMarkerKind,
  TimelineMarkerPayload
} from "#pipeline/timeline/index.js";

export type { CaptureVideoPayload } from "#pipeline/capture/index.js";
import type { CaptureVideoPayload } from "#pipeline/capture/index.js";
import type { TimelineMarkerPayload } from "#pipeline/timeline/index.js";

export type VideoTrackItem = {
  readonly kind: "video";
  readonly trackId: string;
  readonly sequence: number;
  readonly epoch: number;
  readonly mediaTimeMs: number;
  readonly wallTimeMs: number;
  readonly payloadBytes: number;
  readonly payload: CaptureVideoPayload;
};

export type MarkerTrackItem = {
  readonly kind: "marker";
  readonly trackId: string;
  readonly sequence: number;
  readonly epoch: number;
  readonly wallTimeMs: number;
  readonly mediaTimeMs?: number;
  readonly payloadBytes: 0;
  readonly marker: TimelineMarker;
};

export type TrackItem = VideoTrackItem | MarkerTrackItem;

export const appendTimelineMarker = (
  state: WorkerState,
  trackId: string,
  marker: TimelineMarker
): void => {
  const item: MarkerTrackItem = {
    kind: "marker",
    trackId,
    sequence: nextTrackSequence(state, trackId),
    epoch: state.epoch,
    wallTimeMs: marker.wallClockMs,
    ...(marker.mediaTimeMs === undefined ? {} : { mediaTimeMs: marker.mediaTimeMs }),
    payloadBytes: 0,
    marker
  };

  appendTrackItem(state, item);
};

export const appendEosMarker = (state: WorkerState, trackId: string): void => {
  appendTimelineMarker(state, trackId, createTimelineMarker(state, trackId, "eos"));
};

export const appendPauseStartMarker = (
  state: WorkerState,
  trackId: string,
  payload: TimelineMarkerPayload
): void => {
  appendTimelineMarker(
    state,
    trackId,
    createTimelineMarker(state, trackId, "pause-start", payload)
  );
};

export const appendPauseEndMarker = (
  state: WorkerState,
  trackId: string,
  payload: TimelineMarkerPayload
): void => {
  appendTimelineMarker(
    state,
    trackId,
    createTimelineMarker(state, trackId, "pause-end", payload)
  );
};

export const appendDiscontinuityMarker = (
  state: WorkerState,
  trackId: string,
  payload: TimelineMarkerPayload
): void => {
  appendTimelineMarker(
    state,
    trackId,
    createTimelineMarker(state, trackId, "discontinuity", payload)
  );
};

export const appendPresentationSlateMarker = (
  state: WorkerState,
  trackId: string,
  payload: TimelineMarkerPayload
): void => {
  appendTimelineMarker(
    state,
    trackId,
    createTimelineMarker(state, trackId, "presentation-slate", payload)
  );
};

export const trackHasMarkerKind = (
  state: WorkerState,
  trackId: string,
  kind: TimelineMarkerKind
): boolean => {
  const track = state.tracks[trackId];
  if (track === undefined) {
    return false;
  }

  for (const item of track.items) {
    if (item.kind === "marker" && item.marker.kind === kind) {
      return true;
    }
  }

  return false;
};

const createTimelineMarker = (
  state: WorkerState,
  trackId: string,
  kind: TimelineMarkerKind,
  payload?: TimelineMarkerPayload
): TimelineMarker => {
  const wallClockMs = Date.now();
  const mediaTimeMs = readLastMediaTimeMs(state, trackId);

  return {
    kind,
    wallClockMs,
    ...(mediaTimeMs === undefined ? {} : { mediaTimeMs }),
    ...(payload === undefined ? {} : { payload })
  };
};
