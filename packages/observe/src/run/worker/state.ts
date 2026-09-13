import { Effect } from "effect";
import type { LiveStreakError } from "@livestreak/core";
import type { SinkAttachment, SinkFinalizeResult } from "#pipeline/publish/index.js";
import type { CaptureDriverDescriptor, CaptureStageHealth } from "#pipeline/capture/index.js";
import type { CaptureFramePull, CaptureLivePauseStageState } from "./capture-pull.js";
import { appendEosMarker as appendEosTimelineMarker } from "./timeline.js";

export type { CaptureFramePull, CaptureLivePauseStageState } from "./capture-pull.js";
export { createCaptureFramePull, createCaptureStageState } from "./capture-pull.js";
export type { TrackItem, VideoTrackItem, MarkerTrackItem } from "./timeline.js";
export {
  appendDiscontinuityMarker,
  appendEosMarker,
  appendPauseEndMarker,
  appendPauseStartMarker,
  appendPresentationSlateMarker,
  appendTimelineMarker,
  trackHasMarkerKind
} from "./timeline.js";

export type WorkerLifecycle =
  | "idle"
  | "running"
  | "pausing"
  | "paused"
  | "resuming"
  | "stopping"
  | "draining"
  | "stopped"
  | "failed";

export interface WorkerPauseCycle {
  started: boolean;
  presentationMarkerAppended: boolean;
  presentationApplied?: boolean;
  presentationResumed?: boolean;
}

export interface TrackCursor {
  nextSequence: number;
}

export interface TrackState {
  items: import("./timeline.js").TrackItem[];
  cursors: Record<string, TrackCursor>;
  /** Monotonic append counter — sequences survive pruning of consumed items. */
  nextSequence: number;
  /** Media time of the newest video item ever on the track (survives pruning; markers timestamp from it). */
  lastVideoMediaTimeMs?: number;
  /** Video frames dropped by the latest-frame-wins window bound. */
  droppedVideoItems: number;
}

export interface ManifestTrack {
  readonly id: string;
  readonly role: string;
  readonly kind: import("#pipeline/process/types.js").ProcessItemKind;
  readonly payload: string;
  readonly timebase: "milliseconds";
  readonly required: boolean;
  readonly sourceTrackId?: string;
}

export interface PublishManifest {
  readonly version: 1;
  readonly fixedAfterPrepare: true;
  readonly tracks: readonly ManifestTrack[];
}

export interface CaptureStageState {
  readonly pull: CaptureFramePull;
  readonly descriptor: CaptureDriverDescriptor;
  readonly readHealth: Effect.Effect<CaptureStageHealth, LiveStreakError>;
  health?: CaptureStageHealth;
  exhausted: boolean;
  eosAppended: boolean;
  livePause?: CaptureLivePauseStageState;
}

export interface SinkStageState {
  readonly attachment: SinkAttachment;
  finalized: boolean;
  deliveredItems: number;
  finalizeResult?: SinkFinalizeResult;
  readonly drainedTracks: Record<string, boolean>;
}

export interface WorkerState {
  readonly runId: string;
  lastAppliedControlRevision: number;
  lifecycle: WorkerLifecycle;
  epoch: number;
  pauseCycle?: WorkerPauseCycle;
  readonly manifest: PublishManifest;
  readonly tracks: Record<string, TrackState>;
  capture?: CaptureStageState;
  readonly sinks: Record<string, SinkStageState>;
  error?: string;
}

export const CAPTURE_VIDEO_RAW_TRACK_ID = "capture.video.raw";
export const PUBLISH_VIDEO_RENDERED_TRACK_ID = "publish.video.rendered";

export const createPassthroughVideoManifest = (): PublishManifest => ({
  version: 1,
  fixedAfterPrepare: true,
  tracks: [
    {
      id: CAPTURE_VIDEO_RAW_TRACK_ID,
      role: "source-video",
      kind: "video",
      payload: "rgba-frame",
      timebase: "milliseconds",
      required: true
    },
    {
      id: PUBLISH_VIDEO_RENDERED_TRACK_ID,
      role: "primary-video",
      kind: "video",
      payload: "rgba-frame",
      timebase: "milliseconds",
      required: true,
      sourceTrackId: CAPTURE_VIDEO_RAW_TRACK_ID
    }
  ]
});

export const createEmptyWorkerState = (input: CreateEmptyWorkerStateInput): WorkerState => {
  const manifest = input.manifest;
  const tracks: Record<string, TrackState> = {};

  for (const track of manifest.tracks) {
    tracks[track.id] = {
      items: [],
      cursors: {},
      nextSequence: 0,
      droppedVideoItems: 0
    };
  }

  return {
    runId: input.runId,
    lastAppliedControlRevision: 0,
    lifecycle: "idle",
    epoch: 0,
    manifest,
    tracks,
    capture: input.capture,
    sinks: input.sinks
  };
};

export const resolveManifestSourceTrackId = (
  manifest: PublishManifest,
  publishTrackId: string
): string | undefined => {
  for (const track of manifest.tracks) {
    if (track.id === publishTrackId) {
      if (track.sourceTrackId !== undefined) {
        return track.sourceTrackId;
      }
      return track.id;
    }
  }

  return undefined;
};

export const failWorker = (state: WorkerState, message: string): void => {
  state.lifecycle = "failed";
  state.error = message;
};

// Latest-frame-wins bound on UNCONSUMED video per track: raw frames are megabytes each, so a stalled
// consumer must shed stale backlog instead of queueing it (live video standard). Lockstep pumping keeps
// the window at ~1-2 in practice; the bound is the structural guarantee.
export const maxUnconsumedVideoFrames = 16;

export const appendTrackItem = (
  state: WorkerState,
  item: import("./timeline.js").TrackItem
): void => {
  const track = state.tracks[item.trackId];
  if (track === undefined) {
    failWorker(state, `Unknown track ${item.trackId}`);
    return;
  }

  track.items.push(item);
  track.nextSequence = Math.max(track.nextSequence, item.sequence + 1);

  if (item.kind === "video") {
    rememberVideoMediaTime(track, item.mediaTimeMs);
    enforceVideoWindow(track);
  }
};

export const nextTrackSequence = (state: WorkerState, trackId: string): number => {
  const track = state.tracks[trackId];
  if (track === undefined) {
    return 0;
  }

  const last = track.items[track.items.length - 1];
  return Math.max(track.nextSequence, last === undefined ? 0 : last.sequence + 1);
};

export const readLastMediaTimeMs = (
  state: WorkerState,
  trackId: string
): number | undefined => {
  const track = state.tracks[trackId];
  if (track === undefined) {
    return undefined;
  }

  for (let index = track.items.length - 1; index >= 0; index -= 1) {
    const item = track.items[index];
    if (item === undefined) {
      continue;
    }
    if (item.kind === "video") {
      return item.mediaTimeMs;
    }
  }

  return track.lastVideoMediaTimeMs;
};

export const readTrackItem = (
  state: WorkerState,
  trackId: string,
  cursorId: string
): import("./timeline.js").TrackItem | undefined => {
  const track = state.tracks[trackId];
  if (track === undefined) {
    return undefined;
  }

  let cursor = track.cursors[cursorId];
  if (cursor === undefined) {
    cursor = { nextSequence: 0 };
    track.cursors[cursorId] = cursor;
  }

  // Skip-forward: dropped frames leave sequence gaps; a lagging consumer resumes at the oldest
  // retained item (markers are never dropped, so none are skipped).
  for (const item of track.items) {
    if (item.sequence >= cursor.nextSequence) {
      return item;
    }
  }

  return undefined;
};

export const commitTrackCursor = (
  state: WorkerState,
  trackId: string,
  cursorId: string,
  consumedSequence: number
): void => {
  const track = state.tracks[trackId];
  if (track === undefined) {
    failWorker(state, `Unknown track ${trackId}`);
    return;
  }

  let cursor = track.cursors[cursorId];
  if (cursor === undefined) {
    cursor = { nextSequence: 0 };
    track.cursors[cursorId] = cursor;
  }

  cursor.nextSequence = Math.max(cursor.nextSequence, consumedSequence + 1);
  pruneConsumedVideoItems(track);
};

export const ensureCaptureEndForStop = (state: WorkerState): void => {
  const capture = state.capture;
  if (capture === undefined) {
    return;
  }

  capture.exhausted = true;

  if (capture.eosAppended) {
    return;
  }

  appendEosTimelineMarker(state, CAPTURE_VIDEO_RAW_TRACK_ID);
  capture.eosAppended = true;
};

export const refreshCaptureStageHealth = (
  state: WorkerState
): Effect.Effect<void, LiveStreakError> => {
  const capture = state.capture;
  if (capture === undefined) {
    return Effect.void;
  }

  return Effect.gen(function* () {
    const health = yield* capture.readHealth.pipe(
      Effect.catchAll((error) => {
        failWorker(state, healthErrorMessage(error));
        return Effect.fail(error);
      })
    );
    capture.health = health;
  }).pipe(Effect.catchAll(() => Effect.void));
};

export interface CreateEmptyWorkerStateInput {
  readonly runId: string;
  readonly manifest: PublishManifest;
  readonly capture?: CaptureStageState;
  readonly sinks: Record<string, SinkStageState>;
}

export type { TrackItem as WorkerTrackItem } from "./timeline.js";

// --- helpers ---

const rememberVideoMediaTime = (track: TrackState, mediaTimeMs: number): void => {
  if (track.lastVideoMediaTimeMs === undefined || mediaTimeMs > track.lastVideoMediaTimeMs) {
    track.lastVideoMediaTimeMs = mediaTimeMs;
  }
};

// Frame payloads are the memory: once EVERY cursor has consumed a video item it is garbage — drop it.
// Markers are byte-free control items (eos/pause) that drain logic and trackHasMarkerKind rely on; keep them.
const pruneConsumedVideoItems = (track: TrackState): void => {
  const cursors = Object.values(track.cursors);
  if (cursors.length === 0) {
    return;
  }

  let minSequence = Number.POSITIVE_INFINITY;
  for (const cursor of cursors) {
    minSequence = Math.min(minSequence, cursor.nextSequence);
  }

  if (track.items.some((item) => item.kind === "video" && item.sequence < minSequence)) {
    track.items = track.items.filter((item) => {
      if (item.kind === "video" && item.sequence < minSequence) {
        rememberVideoMediaTime(track, item.mediaTimeMs);
        return false;
      }
      return true;
    });
  }
};

// Drop the OLDEST unconsumed video frames past the window (latest-frame-wins); never touches markers,
// never blocks the producer.
const enforceVideoWindow = (track: TrackState): void => {
  let videoCount = 0;
  for (const item of track.items) {
    if (item.kind === "video") {
      videoCount += 1;
    }
  }

  let excess = videoCount - maxUnconsumedVideoFrames;
  if (excess <= 0) {
    return;
  }

  track.items = track.items.filter((item) => {
    if (excess > 0 && item.kind === "video") {
      excess -= 1;
      track.droppedVideoItems += 1;
      rememberVideoMediaTime(track, item.mediaTimeMs);
      return false;
    }
    return true;
  });
};

const healthErrorMessage = (error: LiveStreakError): string => {
  if ("message" in error) {
    return error.message;
  }
  return "capture health read failed";
};
