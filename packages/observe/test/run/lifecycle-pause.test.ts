 
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { nowTimePoint } from "@livestreak/schema";
import type { RawFrame } from "#pipeline/capture/index.js";
import { projectWorkerControlView } from "#run/control/board/index.js";
import { supervisorTurn } from "#run/worker/supervisor.js";
import {
  CAPTURE_VIDEO_RAW_TRACK_ID,
  createEmptyWorkerState,
  createPassthroughVideoManifest,
  readTrackItem,
  trackHasMarkerKind,
  type CaptureStageState,
  type SinkStageState,
  type WorkerState
} from "#run/worker/state.js";
import type { SinkAttachment } from "#pipeline/publish/index.js";
import { systemMemoryBoardCell, systemTickBoardCell } from "#test/helpers/board.js";

describe("worker pause lifecycle", () => {
  it("does not read board status to drive worker lifecycle", async () => {
    const state = makeRunningState();
    appendVideoFrame(state);

    const boardSaysPaused = makeBoardView({
      revision: 1,
      runStatus: "paused",
      pauseRequested: false
    });

    await Effect.runPromise(supervisorTurn(state, boardSaysPaused));

    expect(state.lifecycle).toBe("running");
  });

  it("enters paused immediately from pause settings intent without draining sink backlog", async () => {
    const state = makeRunningState();
    appendVideoFrame(state);

    const pauseView = makeBoardView({
      revision: 1,
      runStatus: "running",
      pauseRequested: true,
      whilePaused: "hold"
    });

    await Effect.runPromise(supervisorTurn(state, pauseView));
    expect(state.lifecycle).toBe("paused");
    expect(trackHasMarkerKind(state, CAPTURE_VIDEO_RAW_TRACK_ID, "pause-start")).toBe(true);
    expect(trackHasMarkerKind(state, CAPTURE_VIDEO_RAW_TRACK_ID, "presentation-slate")).toBe(
      false
    );
    expect(trackHasMarkerKind(state, CAPTURE_VIDEO_RAW_TRACK_ID, "pause-end")).toBe(false);

    const sinkCursorId = "sink:file-export:publish.video.rendered";
    const pendingVideo = readTrackItem(state, CAPTURE_VIDEO_RAW_TRACK_ID, sinkCursorId);
    expect(pendingVideo?.kind).toBe("video");
    expect(pendingVideo?.sequence).toBe(0);

    await Effect.runPromise(supervisorTurn(state, pauseView));
    expect(state.lifecycle).toBe("paused");
  });

  it("does not keep worker in pausing while sink backlog remains", async () => {
    const state = makeRunningState();
    appendVideoFrame(state);

    const pauseView = makeBoardView({
      revision: 1,
      runStatus: "running",
      pauseRequested: true,
      whilePaused: "hold"
    });

    await Effect.runPromise(supervisorTurn(state, pauseView));

    expect(state.lifecycle).not.toBe("pausing");
    expect(state.lifecycle).toBe("paused");
  });

  it("appends presentation-slate marker when whilePaused is slate", async () => {
    const state = makeRunningState();

    const pauseView = makeBoardView({
      revision: 1,
      runStatus: "running",
      pauseRequested: true,
      whilePaused: "slate",
      slateAssetId: "asset1"
    });

    await Effect.runPromise(supervisorTurn(state, pauseView));

    expect(trackHasMarkerKind(state, CAPTURE_VIDEO_RAW_TRACK_ID, "presentation-slate")).toBe(true);
  });

  it("resumes from pause settings intent and appends pause-end", async () => {
    const state = makeRunningState();

    const pauseView = makeBoardView({
      revision: 1,
      runStatus: "running",
      pauseRequested: true
    });
    await Effect.runPromise(supervisorTurn(state, pauseView));
    await Effect.runPromise(supervisorTurn(state, pauseView));
    expect(state.lifecycle).toBe("paused");

    const resumeView = makeBoardView({
      revision: 2,
      runStatus: "paused",
      pauseRequested: false
    });
    await Effect.runPromise(supervisorTurn(state, resumeView));

    expect(state.lifecycle).toBe("running");
    expect(trackHasMarkerKind(state, CAPTURE_VIDEO_RAW_TRACK_ID, "pause-end")).toBe(true);
  });
});

// --- helpers ---

const makeRunningState = (): WorkerState => {
  const capture: CaptureStageState = {
    pull: {
      pullNext: () => Effect.succeed(makeFrame(0))
    },
    descriptor: {
      kind: "capture",
      id: "synthetic",
      version: "0.1.0",
      displayName: "Synthetic",
      capabilityScopes: [],
      flags: [],
      commands: [],
      sourceType: "synthetic",
      sourceMode: "file"
    },
    readHealth: Effect.succeed({
      stage: "capture",
      descriptorId: "synthetic",
      status: "running",
      updatedAtMs: 0,
      sourceId: "capture:synthetic",
      frameCount: 1,
      droppedFrames: 0
    }),
    exhausted: false,
    eosAppended: false
  };

  const state = createEmptyWorkerState({
    runId: "run_pause_lifecycle",
    manifest: createPassthroughVideoManifest(),
    capture,
    sinks: {
      "file-export": makeCaughtUpSinkState()
    }
  });
  state.lifecycle = "running";
  return state;
};

const appendVideoFrame = (state: WorkerState): void => {
  const track = state.tracks[CAPTURE_VIDEO_RAW_TRACK_ID];
  if (track === undefined) {
    return;
  }

  track.items.push({
    kind: "video",
    trackId: CAPTURE_VIDEO_RAW_TRACK_ID,
    sequence: 0,
    epoch: 0,
    mediaTimeMs: 0,
    wallTimeMs: 0,
    payloadBytes: 4,
    payload: {
      width: 1,
      height: 1,
      byteFormat: "jpeg",
      encoding: "jpeg",
      data: new Uint8Array(4)
    }
  });
};

const makeBoardView = (options: {
  revision: number;
  runStatus: string;
  pauseRequested: boolean;
  whilePaused?: "hold" | "slate";
  slateAssetId?: string;
}) =>
  projectWorkerControlView({
    revision: options.revision,
    catalogVersion: "0.1.0",
    cells: {
      "system:run": {
        label: "Run",
        status: [options.runStatus, null, Date.now()],
        settings: { stopRequested: false },
        functions: []
      },
      "system:pause": {
        label: "Pause",
        status: ["idle", null, Date.now()],
        settings: {
          requested: options.pauseRequested,
          ...(options.whilePaused === undefined ? {} : { whilePaused: options.whilePaused }),
          ...(options.slateAssetId === undefined ? {} : { slateAssetId: options.slateAssetId })
        },
        functions: []
      },
      "system:memory": systemMemoryBoardCell(),
      "system:tick": systemTickBoardCell(),
      "sink:file-export": {
        label: "File Export",
        status: ["idle", null, Date.now()],
        settings: {
          path: "/tmp/out.mp4",
          subscribe: ["publish.video.rendered"],
          required: true
        },
        functions: []
      }
    }
  });

const makeCaughtUpSinkState = (): SinkStageState => ({
  attachment: {
    id: "test-sink",
    deliver: () => Effect.void,
    finalize: Effect.succeed({ deliveredItems: 0, output: { kind: "memory" } }),
    health: Effect.succeed({
      stage: "publish",
      descriptorId: "memory",
      status: "running",
      updatedAtMs: 0,
      deliveredItems: 0
    }),
    detach: Effect.void
  } satisfies SinkAttachment,
  finalized: false,
  deliveredItems: 0,
  drainedTracks: {}
});

const makeFrame = (index: number): RawFrame => ({
  id: `frame:${index}`,
  sourceId: "capture:synthetic",
  time: nowTimePoint(index),
  cadence: {
    mode: "synthetic",
    sequence: index,
    droppedFrames: 0
  },
  payload: {
    width: 1,
    height: 1,
    byteFormat: "jpeg",
    encoding: "jpeg",
    data: new Uint8Array(4)
  }
});
