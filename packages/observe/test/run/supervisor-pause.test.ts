/* eslint-disable unicorn/no-null -- BoardCell.status tuple uses null for absent message */
import { Effect, Either, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { LiveStreakRuntimeError } from "@livestreak/core";
import { nowTimePoint } from "@livestreak/schema";
import type { CaptureLiveControls, FrameSource, RawFrame } from "#pipeline/capture/index.js";
import { projectWorkerControlView } from "#run/control/board/index.js";
import { createCaptureStageState } from "#run/worker/capture-pull.js";
import { supervisorTurn } from "#run/worker/supervisor.js";
import {
  createEmptyWorkerState,
  createPassthroughVideoManifest,
  readTrackItem,
  CAPTURE_VIDEO_RAW_TRACK_ID,
  trackHasMarkerKind,
  type CaptureStageState,
  type SinkStageState
} from "#run/worker/state.js";
import type { SinkAttachment } from "#pipeline/publish/index.js";
import { systemMemoryBoardCell, systemTickBoardCell } from "#test/helpers/board.js";

describe("supervisor live pause", () => {
  it("fails prepare when a live source is missing CaptureLiveControls", async () => {
    const source: FrameSource = {
      descriptor: {
        kind: "capture",
        id: "browser",
        version: "0.1.0",
        displayName: "Browser",
        capabilityScopes: ["capture:browser:*"],
        flags: [],
        commands: [],
        sourceType: "browser",
        sourceMode: "live"
      },
      frames: Stream.empty,
      health: Effect.succeed({
        stage: "capture",
        descriptorId: "browser",
        status: "idle",
        updatedAtMs: 0,
        sourceId: "capture:browser",
        frameCount: 0,
        droppedFrames: 0
      })
    };

    const result = await Effect.runPromise(
      Effect.scoped(createCaptureStageState(source)).pipe(Effect.either)
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(LiveStreakRuntimeError);
      expect(result.left.message).toContain("missing CaptureLiveControls");
    }
  });

  it("calls live pause and resume from system pause without resume on stop", async () => {
    const live = makeCountingLiveControls();
    const state = makeRunningWorkerState(live.controls);

    const pausedView = makeBoardView({
      revision: 1,
      pause: { requested: true, whilePaused: "hold" }
    });
    const pausedTurn = await Effect.runPromise(supervisorTurn(state, pausedView));

    expect(pausedTurn.lifecycle).toBe("paused");
    expect(live.counts.pauseCalls).toBe(1);
    expect(live.counts.resumeCalls).toBe(0);
    expect(state.capture?.livePause?.paused).toBe(true);

    const repeatPauseView = makeBoardView({
      revision: 1,
      pause: { requested: true, whilePaused: "hold" }
    });
    await Effect.runPromise(supervisorTurn(state, repeatPauseView));
    expect(live.counts.pauseCalls).toBe(1);

    const resumedView = makeBoardView({
      revision: 2,
      pause: { requested: false, whilePaused: "hold" }
    });
    await Effect.runPromise(supervisorTurn(state, resumedView));
    expect(live.counts.resumeCalls).toBe(1);
    expect(state.capture?.livePause?.paused).toBe(false);

    state.capture!.livePause!.paused = true;
    const pauseCallsBeforeStop = live.counts.pauseCalls;
    const resumeCallsBeforeStop = live.counts.resumeCalls;

    const stopView = makeBoardView({
      revision: 3,
      pause: { requested: true, whilePaused: "hold" },
      stopRequested: true
    });
    await Effect.runPromise(supervisorTurn(state, stopView));
    expect(live.counts.resumeCalls).toBe(resumeCallsBeforeStop);
    expect(live.counts.pauseCalls).toBe(pauseCallsBeforeStop);
  });

  it("enters paused immediately with sink backlog without delivering queued video", async () => {
    const live = makeCountingLiveControls();
    const state = makeRunningWorkerState(live.controls);
    appendVideoFrame(state);

    const pausedTurn = await Effect.runPromise(
      supervisorTurn(
        state,
        makeBoardView({
          revision: 1,
          pause: { requested: true, whilePaused: "hold" }
        })
      )
    );

    expect(pausedTurn.lifecycle).toBe("paused");
    expect(live.counts.pauseCalls).toBe(1);
    expect(trackHasMarkerKind(state, CAPTURE_VIDEO_RAW_TRACK_ID, "pause-start")).toBe(true);

    const sinkCursorId = "sink:file-export:publish.video.rendered";
    const pendingVideo = readTrackItem(state, CAPTURE_VIDEO_RAW_TRACK_ID, sinkCursorId);
    expect(pendingVideo?.kind).toBe("video");
    expect(pendingVideo?.sequence).toBe(0);
  });

  it("does not re-call live pause when board revision changes while already paused", async () => {
    const live = makeCountingLiveControls();
    const state = makeRunningWorkerState(live.controls);

    await Effect.runPromise(
      supervisorTurn(
        state,
        makeBoardView({
          revision: 1,
          pause: { requested: true, whilePaused: "hold" }
        })
      )
    );
    expect(live.counts.pauseCalls).toBe(1);

    await Effect.runPromise(
      supervisorTurn(
        state,
        makeBoardView({
          revision: 2,
          pause: { requested: true, whilePaused: "slate", slateAssetId: "asset1" }
        })
      )
    );
    expect(live.counts.pauseCalls).toBe(1);
  });
});

// --- helpers ---

const makeCountingLiveControls = () => {
  const counts = {
    pauseCalls: 0,
    resumeCalls: 0
  };
  let revision = 0;
  let paused = false;

  const controls: CaptureLiveControls = {
    pause: () =>
      Effect.sync(() => {
        counts.pauseCalls += 1;
        revision += 1;
        paused = true;
        return {
          paused,
          revision
        };
      }),
    resume: () =>
      Effect.sync(() => {
        counts.resumeCalls += 1;
        revision += 1;
        paused = false;
        return {
          paused,
          revision
        };
      }),
    snapshot: Effect.sync(() => ({
      paused,
      revision
    }))
  };

  return {
    controls,
    counts
  };
};

const makeRunningWorkerState = (controls: CaptureLiveControls) => {
  const capture: CaptureStageState = {
    pull: {
      pullNext: () => Effect.succeed(makeFrame(0))
    },
    descriptor: {
      kind: "capture",
      id: "browser",
      version: "0.1.0",
      displayName: "Browser",
      capabilityScopes: ["capture:browser:*"],
      flags: [],
      commands: [],
      sourceType: "browser",
      sourceMode: "live"
    },
    readHealth: Effect.succeed({
      stage: "capture",
      descriptorId: "browser",
      status: "running",
      updatedAtMs: 0,
      sourceId: "capture:browser",
      frameCount: 0,
      droppedFrames: 0
    }),
    exhausted: false,
    eosAppended: false,
    livePause: {
      controls,
      paused: false
    }
  };

  const state = createEmptyWorkerState({
    runId: "run_live_pause",
    manifest: createPassthroughVideoManifest(),
    capture,
    sinks: {
      "file-export": makeCaughtUpSinkState()
    }
  });
  state.lifecycle = "running";
  return state;
};

const makeBoardView = (options: {
  revision: number;
  pause: {
    requested: boolean;
    whilePaused: "hold" | "slate";
    slateAssetId?: string;
  };
  stopRequested?: boolean;
}) =>
  projectWorkerControlView({
    revision: options.revision,
    catalogVersion: "0.1.0",
    cells: {
      "system:run": {
        label: "Run",
        status: ["running", null, Date.now()],
        readonly: { runId: "run_live_pause", prepared: true },
        settings: {
          stopRequested: options.stopRequested === true
        },
        functions: []
      },
      "system:pause": {
        label: "Pause",
        status: ["idle", null, Date.now()],
        settings: options.pause,
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

const appendVideoFrame = (state: ReturnType<typeof makeRunningWorkerState>): void => {
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

const makeFrame = (index: number): RawFrame => ({
  id: `frame:${index}`,
  sourceId: "capture:browser",
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
