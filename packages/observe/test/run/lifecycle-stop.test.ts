 
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { projectWorkerControlView } from "#run/control/board/index.js";
import {
  advanceStoppingToDraining,
  promoteStopIfRequested
} from "#run/worker/lifecycle.js";
import {
  CAPTURE_VIDEO_RAW_TRACK_ID,
  createEmptyWorkerState,
  createPassthroughVideoManifest,
  trackHasMarkerKind,
  type CaptureStageState,
  type WorkerState
} from "#run/worker/state.js";
import { systemMemoryBoardCell, systemTickBoardCell } from "#test/helpers/board.js";

describe("worker stop lifecycle", () => {
  it("promotes running to stopping when stop is requested", () => {
    const state = makeWorkerState("running");
    const control = makeControlView({ stopRequested: true });

    promoteStopIfRequested(state, control);

    expect(state.lifecycle).toBe("stopping");
  });

  it("does not promote draining back to stopping when stop remains requested", () => {
    const state = makeWorkerState("draining");
    const control = makeControlView({ stopRequested: true });

    promoteStopIfRequested(state, control);

    expect(state.lifecycle).toBe("draining");
  });

  it("does not promote stopping to stopping again", () => {
    const state = makeWorkerState("stopping");
    const control = makeControlView({ stopRequested: true });

    promoteStopIfRequested(state, control);

    expect(state.lifecycle).toBe("stopping");
  });

  it("advances stopping to draining once capture eos is appended", () => {
    const state = makeWorkerState("stopping");
    state.capture = makeCaptureStage();

    advanceStoppingToDraining(state);

    expect(state.lifecycle).toBe("draining");
    expect(state.capture.eosAppended).toBe(true);
    expect(trackHasMarkerKind(state, CAPTURE_VIDEO_RAW_TRACK_ID, "eos")).toBe(true);
  });
});

// --- helpers ---

const makeWorkerState = (lifecycle: WorkerState["lifecycle"]): WorkerState => {
  const state = createEmptyWorkerState({
    runId: "run_stop_lifecycle",
    manifest: createPassthroughVideoManifest(),
    sinks: {}
  });
  state.lifecycle = lifecycle;
  return state;
};

const makeCaptureStage = (): CaptureStageState => ({
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
  exhausted: false,
  eosAppended: false
});

const makeControlView = (options: { stopRequested: boolean }) =>
  projectWorkerControlView({
    revision: 1,
    catalogVersion: "0.1.0",
    cells: {
      "system:run": {
        label: "Run",
        status: ["running", null, Date.now()],
        settings: { stopRequested: options.stopRequested },
        functions: []
      },
      "system:pause": {
        label: "Pause",
        status: ["idle", null, Date.now()],
        settings: { requested: false, whilePaused: "hold" },
        functions: []
      },
      "system:memory": systemMemoryBoardCell(),
      "system:tick": systemTickBoardCell()
    }
  });
