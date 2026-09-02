 
import { describe, expect, it } from "vitest";
import { projectWorkerControlView } from "#run/control/board/index.js";
import {
  beginPauseCycleIfNeeded,
  completePauseAfterSourcePaused
} from "#run/worker/lifecycle.js";
import {
  appendPauseStartMarker,
  trackHasMarkerKind,
  type VideoTrackItem
} from "#run/worker/timeline.js";
import {
  appendTrackItem,
  CAPTURE_VIDEO_RAW_TRACK_ID,
  createEmptyWorkerState,
  createPassthroughVideoManifest,
  readLastMediaTimeMs,
  type WorkerState
} from "#run/worker/state.js";
import { systemMemoryBoardCell, systemTickBoardCell } from "#test/helpers/board.js";

describe("timeline markers", () => {
  it("readLastMediaTimeMs scans backward for the latest video item", () => {
    const state = makeStateWithTrack();

    expect(readLastMediaTimeMs(state, CAPTURE_VIDEO_RAW_TRACK_ID)).toBeUndefined();

    appendVideo(state, 100);
    appendVideo(state, 250);
    appendPauseStartMarker(state, CAPTURE_VIDEO_RAW_TRACK_ID, {});

    expect(readLastMediaTimeMs(state, CAPTURE_VIDEO_RAW_TRACK_ID)).toBe(250);
  });

  it("keeps TimelineMarker canonical with duplicated top-level transport fields", () => {
    const state = makeStateWithTrack();
    appendVideo(state, 42);

    appendPauseStartMarker(state, CAPTURE_VIDEO_RAW_TRACK_ID, {
      whilePaused: "hold",
      epoch: 0
    });

    const item = state.tracks[CAPTURE_VIDEO_RAW_TRACK_ID]?.items[1];
    expect(item?.kind).toBe("marker");
    if (item?.kind !== "marker") {
      return;
    }

    expect(item.wallTimeMs).toBe(item.marker.wallClockMs);
    expect(item.mediaTimeMs).toBe(item.marker.mediaTimeMs);
    expect(item.marker.kind).toBe("pause-start");
    expect(item.marker.mediaTimeMs).toBe(42);
  });

  it("appends one pause marker set per pause cycle across repeated pausing turns", () => {
    const state = makeStateWithTrack();
    appendVideo(state, 10);

    const control = makePauseControlView({ requested: true, whilePaused: "hold" });

    expect(beginPauseCycleIfNeeded(state, control)).toBe(true);
    expect(trackHasMarkerKind(state, CAPTURE_VIDEO_RAW_TRACK_ID, "pause-start")).toBe(true);
    expect(trackHasMarkerKind(state, CAPTURE_VIDEO_RAW_TRACK_ID, "presentation-slate")).toBe(
      false
    );

    state.lifecycle = "pausing";
    expect(beginPauseCycleIfNeeded(state, control)).toBe(false);
    expect(countMarkerKind(state, "pause-start")).toBe(1);
  });

  it("appends presentation-slate marker when whilePaused is slate", () => {
    const state = makeStateWithTrack();
    appendVideo(state, 5);

    const control = makePauseControlView({
      requested: true,
      whilePaused: "slate",
      slateAssetId: "asset1"
    });

    expect(beginPauseCycleIfNeeded(state, control)).toBe(true);
    expect(countMarkerKind(state, "presentation-slate")).toBe(1);

    state.lifecycle = "pausing";
    expect(beginPauseCycleIfNeeded(state, control)).toBe(false);
    expect(countMarkerKind(state, "presentation-slate")).toBe(1);

    completePauseAfterSourcePaused(state);
    expect(state.lifecycle).toBe("paused");
  });
});

// --- helpers ---

const makeStateWithTrack = (): WorkerState =>
  createEmptyWorkerState({
    runId: "run_timeline",
    manifest: createPassthroughVideoManifest(),
    sinks: {}
  });

const appendVideo = (state: WorkerState, mediaTimeMs: number): void => {
  const item: VideoTrackItem = {
    kind: "video",
    trackId: CAPTURE_VIDEO_RAW_TRACK_ID,
    sequence: state.tracks[CAPTURE_VIDEO_RAW_TRACK_ID]?.items.length ?? 0,
    epoch: state.epoch,
    mediaTimeMs,
    wallTimeMs: mediaTimeMs,
    payloadBytes: 4,
    payload: {
      width: 1,
      height: 1,
      byteFormat: "jpeg",
      encoding: "jpeg",
      data: new Uint8Array(4)
    }
  };

  appendTrackItem(state, item);
};

const makePauseControlView = (options: {
  requested: boolean;
  whilePaused?: "hold" | "slate";
  slateAssetId?: string;
}) =>
  projectWorkerControlView({
    revision: 1,
    catalogVersion: "0.1.0",
    cells: {
      "system:run": {
        label: "Run",
        status: ["running", null, Date.now()],
        settings: { stopRequested: false },
        functions: []
      },
      "system:pause": {
        label: "Pause",
        status: ["idle", null, Date.now()],
        settings: {
          requested: options.requested,
          ...(options.whilePaused === undefined ? {} : { whilePaused: options.whilePaused }),
          ...(options.slateAssetId === undefined ? {} : { slateAssetId: options.slateAssetId })
        },
        functions: []
      },
      "system:memory": systemMemoryBoardCell(),
      "system:tick": systemTickBoardCell()
    }
  });

const countMarkerKind = (state: WorkerState, kind: string): number => {
  const track = state.tracks[CAPTURE_VIDEO_RAW_TRACK_ID];
  if (track === undefined) {
    return 0;
  }

  let count = 0;
  for (const item of track.items) {
    if (item.kind === "marker" && item.marker.kind === kind) {
      count += 1;
    }
  }

  return count;
};
