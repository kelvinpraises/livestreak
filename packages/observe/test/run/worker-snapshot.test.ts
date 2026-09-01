import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { projectWorkerSnapshot } from "#run/worker/snapshot.js";
import type { CaptureStageState, WorkerState } from "#run/worker/state.js";
import { createPassthroughVideoManifest } from "#run/worker/state.js";

describe("projectWorkerSnapshot", () => {
  it("projects capture descriptor and cached health from worker state", () => {
    const captureHealth = {
      stage: "capture" as const,
      descriptorId: "synthetic",
      status: "running" as const,
      updatedAtMs: 1,
      sourceId: "capture:synthetic",
      frameCount: 4,
      droppedFrames: 0
    };

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
        displayName: "Synthetic Capture",
        capabilityScopes: ["capture:synthetic:*"],
        flags: [],
        commands: [],
        sourceType: "synthetic",
        sourceMode: "file"
      },
      readHealth: Effect.succeed(captureHealth),
      health: captureHealth,
      exhausted: true,
      eosAppended: true
    };

    const state: WorkerState = {
      runId: "run_snapshot",
      lastAppliedControlRevision: 2,
      lifecycle: "stopped",
      epoch: 0,
      manifest: createPassthroughVideoManifest(),
      tracks: {},
      capture,
      sinks: {}
    };

    const snapshot = projectWorkerSnapshot(state);

    expect(snapshot.capture).toEqual({
      descriptorId: "synthetic",
      sourceType: "synthetic",
      exhausted: true,
      eosAppended: true,
      health: captureHealth
    });
  });
});
