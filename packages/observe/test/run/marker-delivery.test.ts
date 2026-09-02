 
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { createFileSinkDriver } from "#pipeline/publish/sinks/file/driver.js";
import { projectWorkerControlView } from "#run/control/board/index.js";
import {
  advanceStoppingToDraining,
  completeResumeIfNeeded
} from "#run/worker/lifecycle.js";
import { finalizeSinks, pumpSinks } from "#run/worker/pumps.js";
import { supervisorTurn } from "#run/worker/supervisor.js";
import {
  CAPTURE_VIDEO_RAW_TRACK_ID,
  createEmptyWorkerState,
  createPassthroughVideoManifest,
  readTrackItem,
  type CaptureStageState,
  type WorkerState
} from "#run/worker/state.js";
import type { VideoTrackItem } from "#run/worker/timeline.js";
import {
  createMarkerRecordingSinkDriver,
  type MarkerSinkRecording
} from "#test/helpers/marker-sink.js";
import { systemMemoryBoardCell, systemTickBoardCell } from "#test/helpers/board.js";

describe("marker sink delivery", () => {
  it("does not deliver queued media or pause markers while paused", async () => {
    const { state, control, recording } = await makeWorkerFixture();
    appendVideo(state, 0);

    state.lifecycle = "running";
    await Effect.runPromise(supervisorTurn(state, control));
    expect(state.lifecycle).toBe("paused");

    await drainTrackToSink(state, control);
    expect(recording.deliveries).toEqual([]);

    const cursorId = "sink:file-export:publish.video.rendered";
    const pendingVideo = readTrackItem(state, CAPTURE_VIDEO_RAW_TRACK_ID, cursorId);
    expect(pendingVideo?.kind).toBe("video");
    expect(pendingVideo?.sequence).toBe(0);
  });

  it("delivers pause-end on resume without discontinuity", async () => {
    const { state, control, recording } = await makeWorkerFixture();
    appendVideo(state, 0);

    state.lifecycle = "running";
    await Effect.runPromise(supervisorTurn(state, control));
    expect(state.lifecycle).toBe("paused");
    expect(recording.deliveries).toEqual([]);

    const resumeControl = makeControlView({
      revision: 2,
      pauseRequested: false,
      whilePaused: "hold"
    });
    state.lifecycle = "resuming";
    await Effect.runPromise(completeResumeIfNeeded(state, resumeControl));
    expect(state.lifecycle).toBe("running");
    await drainTrackToSink(state, resumeControl);

    expect(recording.deliveries).toEqual(["video:0", "marker:pause-start", "marker:pause-end"]);
    expect(recording.deliveries).not.toContain("marker:discontinuity");
    expect(recording.deliveries.indexOf("marker:pause-end")).toBeGreaterThan(
      recording.deliveries.indexOf("marker:pause-start")
    );
  });

  it("delivers presentation-slate marker after resume when whilePaused is slate", async () => {
    const { state, recording } = await makeWorkerFixture({
      whilePaused: "slate",
      slateAssetId: "asset1"
    });
    appendVideo(state, 0);

    const pauseControl = makeControlView({
      revision: 1,
      pauseRequested: true,
      whilePaused: "slate",
      slateAssetId: "asset1"
    });

    state.lifecycle = "running";
    await Effect.runPromise(supervisorTurn(state, pauseControl));
    expect(state.lifecycle).toBe("paused");
    expect(recording.deliveries).toEqual([]);

    const resumeControl = makeControlView({
      revision: 2,
      pauseRequested: false,
      whilePaused: "slate",
      slateAssetId: "asset1"
    });
    state.lifecycle = "resuming";
    await Effect.runPromise(completeResumeIfNeeded(state, resumeControl));
    await drainTrackToSink(state, resumeControl);

    expect(recording.deliveries).toContain("marker:presentation-slate");
    expect(recording.deliveries.indexOf("marker:presentation-slate")).toBeGreaterThan(
      recording.deliveries.indexOf("marker:pause-start")
    );
  });

  it("delivers eos marker and finalizes after stop drain", async () => {
    const { state, control, recording } = await makeWorkerFixture();
    appendVideo(state, 0);

    state.lifecycle = "stopping";
    advanceStoppingToDraining(state);
    await drainTrackToSink(state, control);
    state.lifecycle = "draining";
    await drainTrackToSink(state, control);
    await Effect.runPromise(finalizeSinks(state, control));

    expect(recording.deliveries).toContain("marker:eos");
    expect(recording.finalized).toBe(true);
  });

  it("file sink ignores marker deliveries without encoding", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const driver = createFileSinkDriver();
          const attachment = yield* driver.attach({ path: "/tmp/marker-ignore-test.mp4" });

          yield* attachment.deliver({
            kind: "marker",
            sinkId: "file-export",
            trackId: "publish.video.rendered",
            role: "publish.video.rendered",
            sequence: 0,
            epoch: 0,
            wallTimeMs: Date.now(),
            marker: {
              kind: "pause-start",
              wallClockMs: Date.now()
            }
          });

          return yield* attachment.health;
        })
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.deliveredItems).toBe(0);
    }
  });
});

// --- helpers ---

const drainTrackToSink = async (
  state: WorkerState,
  control: ReturnType<typeof makeControlView>,
  maxPumps = 16
): Promise<void> => {
  for (let index = 0; index < maxPumps; index += 1) {
    const result = await Effect.runPromise(pumpSinks(state, control));
    if (result.didWork === false) {
      return;
    }
  }
};

const makeWorkerFixture = (defaults?: {
  whilePaused?: "hold" | "slate";
  slateAssetId?: string;
}): Promise<{
  state: WorkerState;
  control: ReturnType<typeof makeControlView>;
  recording: MarkerSinkRecording;
}> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { driver, recording } = createMarkerRecordingSinkDriver();
        const attachment = yield* driver.attach({ path: "/tmp/marker-delivery.mp4" });

        const capture: CaptureStageState = {
          pull: {
            pullNext: () => {
              const empty: undefined = undefined;
              return Effect.succeed(empty);
            }
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
            frameCount: 0,
            droppedFrames: 0
          }),
          exhausted: true,
          eosAppended: false
        };

        const state = createEmptyWorkerState({
          runId: "run_marker_delivery",
          manifest: createPassthroughVideoManifest(),
          capture,
          sinks: {
            "file-export": {
              attachment,
              finalized: false,
              deliveredItems: 0,
              drainedTracks: {}
            }
          }
        });
        state.lifecycle = "running";

        return {
          state,
          control: makeControlView({
            revision: 1,
            pauseRequested: true,
            whilePaused: defaults?.whilePaused ?? "hold",
            ...(defaults?.slateAssetId === undefined
              ? {}
              : { slateAssetId: defaults.slateAssetId })
          }),
          recording
        };
      })
    )
  );

const appendVideo = (state: WorkerState, sequence: number): void => {
  const item: VideoTrackItem = {
    kind: "video",
    trackId: CAPTURE_VIDEO_RAW_TRACK_ID,
    sequence,
    epoch: state.epoch,
    mediaTimeMs: sequence * 33,
    wallTimeMs: sequence * 33,
    payloadBytes: 4,
    payload: {
      width: 1,
      height: 1,
      byteFormat: "jpeg",
      encoding: "jpeg",
      data: new Uint8Array(4)
    }
  };

  state.tracks[CAPTURE_VIDEO_RAW_TRACK_ID]?.items.push(item);
};

const makeControlView = (options: {
  revision: number;
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
        status: ["running", null, Date.now()],
        settings: { stopRequested: false },
        functions: []
      },
      "system:pause": {
        label: "Pause",
        status: ["idle", null, Date.now()],
        settings: {
          requested: options.pauseRequested,
          whilePaused: options.whilePaused ?? "hold",
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
          path: "/tmp/marker-delivery.mp4",
          subscribe: ["publish.video.rendered"],
          required: true
        },
        functions: []
      }
    }
  });
