 
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { LiveStreakRuntimeError } from "@livestreak/core";
import { nowTimePoint } from "@livestreak/schema";
import type { RawFrame } from "#pipeline/capture/index.js";
import type {
  SinkAttachment,
  SinkPresentationControls
} from "#pipeline/publish/index.js";
import { projectWorkerControlView } from "#run/control/board/index.js";
import { shouldPumpSinks } from "#run/worker/lifecycle.js";
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
import { createPresentationRecordingAttachment } from "#test/helpers/presentation-sink.js";
import { systemMemoryBoardCell, systemTickBoardCell } from "#test/helpers/board.js";

describe("pause presentation runtime", () => {
  it("calls sink presentation hook once for hold and does not pump sinks while paused", async () => {
    const presentationCalls: string[] = [];
    const deliveredVideos: number[] = [];
    const state = makeRunningState({
      presentationCalls,
      deliveredVideos
    });
    appendVideoFrame(state);

    const pauseView = makeBoardView({
      revision: 1,
      pauseRequested: true,
      whilePaused: "hold"
    });

    await Effect.runPromise(supervisorTurn(state, pauseView));

    expect(state.lifecycle).toBe("paused");
    expect(presentationCalls).toEqual(["pause:hold"]);
    expect(deliveredVideos).toEqual([]);
    expect(shouldPumpSinks(state.lifecycle)).toBe(false);

    const pendingVideo = readTrackItem(
      state,
      CAPTURE_VIDEO_RAW_TRACK_ID,
      "sink:file-export:publish.video.rendered"
    );
    expect(pendingVideo?.kind).toBe("video");
    expect(pendingVideo?.sequence).toBe(0);
  });

  it("passes slateAssetId to sink presentation hook and appends presentation-slate marker", async () => {
    const presentationCalls: string[] = [];
    const state = makeRunningState({ presentationCalls });

    const pauseView = makeBoardView({
      revision: 1,
      pauseRequested: true,
      whilePaused: "slate",
      slateAssetId: "asset1"
    });

    await Effect.runPromise(supervisorTurn(state, pauseView));

    expect(presentationCalls).toEqual(["pause:slate:asset1"]);
    expect(trackHasMarkerKind(state, CAPTURE_VIDEO_RAW_TRACK_ID, "presentation-slate")).toBe(true);
    expect(JSON.stringify(state.tracks)).not.toContain("data:image");
    expect(JSON.stringify(state.tracks)).not.toMatch(/data:image/);
  });

  it("does not re-call sink presentation on repeated paused turns", async () => {
    const presentationCalls: string[] = [];
    const state = makeRunningState({ presentationCalls });

    const pauseView = makeBoardView({
      revision: 1,
      pauseRequested: true,
      whilePaused: "hold"
    });

    await Effect.runPromise(supervisorTurn(state, pauseView));
    await Effect.runPromise(supervisorTurn(state, pauseView));
    await Effect.runPromise(supervisorTurn(state, pauseView));

    expect(presentationCalls).toEqual(["pause:hold"]);
  });

  it("calls resumePresentation once and appends pause-end on resume", async () => {
    const presentationCalls: string[] = [];
    const state = makeRunningState({ presentationCalls });

    const pauseView = makeBoardView({
      revision: 1,
      pauseRequested: true,
      whilePaused: "hold"
    });
    await Effect.runPromise(supervisorTurn(state, pauseView));

    const resumeView = makeBoardView({
      revision: 2,
      pauseRequested: false,
      whilePaused: "hold"
    });
    await Effect.runPromise(supervisorTurn(state, resumeView));

    expect(presentationCalls).toEqual(["pause:hold", "resume"]);
    expect(trackHasMarkerKind(state, CAPTURE_VIDEO_RAW_TRACK_ID, "pause-end")).toBe(true);
    expect(state.lifecycle).toBe("running");
  });

  it("does not call resumePresentation when stop is requested while paused", async () => {
    const presentationCalls: string[] = [];
    const state = makeRunningState({ presentationCalls });

    await Effect.runPromise(
      supervisorTurn(
        state,
        makeBoardView({
          revision: 1,
          pauseRequested: true,
          whilePaused: "hold"
        })
      )
    );

    await Effect.runPromise(
      supervisorTurn(
        state,
        makeBoardView({
          revision: 2,
          pauseRequested: true,
          whilePaused: "hold",
          stopRequested: true
        })
      )
    );

    expect(presentationCalls).toEqual(["pause:hold"]);
    expect(presentationCalls).not.toContain("resume");
    expect(["stopping", "draining", "stopped"]).toContain(state.lifecycle);
  });

  it("ignores sinks without presentation hooks", async () => {
    const state = makeRunningState({ includePresentationHook: false });

    await Effect.runPromise(
      supervisorTurn(
        state,
        makeBoardView({
          revision: 1,
          pauseRequested: true,
          whilePaused: "hold"
        })
      )
    );

    expect(state.lifecycle).toBe("paused");

    await Effect.runPromise(
      supervisorTurn(
        state,
        makeBoardView({
          revision: 2,
          pauseRequested: false,
          whilePaused: "hold"
        })
      )
    );

    expect(state.lifecycle).toBe("running");
  });

  it("fails the worker when sink presentation hook fails", async () => {
    const state = makeRunningState({
      pausePresentation: () =>
        Effect.fail(
          new LiveStreakRuntimeError({
            message: "presentation hook failed"
          })
        )
    });

    await Effect.runPromise(
      supervisorTurn(
        state,
        makeBoardView({
          revision: 1,
          pauseRequested: true,
          whilePaused: "hold"
        })
      )
    );

    expect(state.lifecycle).toBe("failed");
    expect(state.error).toContain("Sink presentation pause failed");
    expect(state.error).toContain("presentation hook failed");
  });
});

// --- helpers ---

const makeRunningState = (options: {
  readonly presentationCalls?: string[];
  readonly deliveredVideos?: number[];
  readonly includePresentationHook?: boolean;
  readonly pausePresentation?: SinkPresentationControls["pausePresentation"];
}): WorkerState => {
  const presentationCalls = options.presentationCalls ?? [];
  const deliveredVideos = options.deliveredVideos ?? [];
  const includePresentationHook = options.includePresentationHook ?? true;

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

  const attachment = includePresentationHook
    ? createPresentationRecordingAttachment({
        presentationCalls,
        deliveredVideos,
        ...(options.pausePresentation === undefined
          ? {}
          : { pausePresentation: options.pausePresentation })
      })
    : makePlainSinkAttachment(deliveredVideos);

  const state = createEmptyWorkerState({
    runId: "run_pause_presentation",
    manifest: createPassthroughVideoManifest(),
    capture,
    sinks: {
      "file-export": makeSinkState(attachment)
    }
  });
  state.lifecycle = "running";
  return state;
};

const makePlainSinkAttachment = (deliveredVideos: number[]): SinkAttachment => ({
  id: "plain-sink",
  deliver: (item) =>
    Effect.sync(() => {
      if (item.kind === "video") {
        deliveredVideos.push(item.sequence);
      }
    }),
  finalize: Effect.succeed({ deliveredItems: deliveredVideos.length, output: { kind: "memory" } }),
  health: Effect.succeed({
    stage: "publish",
    descriptorId: "memory",
    status: "running",
    updatedAtMs: 0,
    deliveredItems: deliveredVideos.length
  }),
  detach: Effect.void
});

const makeSinkState = (attachment: SinkAttachment): SinkStageState => ({
  attachment,
  finalized: false,
  deliveredItems: 0,
  drainedTracks: {}
});

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
  pauseRequested: boolean;
  whilePaused?: "hold" | "slate";
  slateAssetId?: string;
  stopRequested?: boolean;
}) =>
  projectWorkerControlView({
    revision: options.revision,
    catalogVersion: "0.1.0",
    cells: {
      "system:run": {
        label: "Run",
        status: ["running", null, Date.now()],
        settings: {
          stopRequested: options.stopRequested === true
        },
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
