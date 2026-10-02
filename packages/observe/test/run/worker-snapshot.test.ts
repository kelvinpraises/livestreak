import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { projectWorkerSnapshot } from "#run/worker/snapshot.js";
import { applyWorkerSnapshotToBoard } from "#run/control/board/index.js";
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

describe("applyWorkerSnapshotToBoard owner routing", () => {
  const ownerBoard = {
    revision: 3,
    catalogVersion: "0.1.0",
    cells: {
      "obs:a:capture": {
        label: "Capture",
        catalog: "capture:file",
        status: ["running", null, 1] as const,
        settings: {},
        readonly: { configured: true },
        functions: ["configure", "close"]
      },
      "obs:a:run": {
        label: "Run",
        catalog: "system:run",
        status: ["running", null, 1] as const,
        settings: {},
        readonly: { prepared: true },
        functions: ["prepare", "start"]
      },
      "obs:a:publish": {
        label: "Publish",
        catalog: "sink:live",
        status: ["configured", null, 1] as const,
        settings: { subscribe: ["publish.video.rendered"] },
        readonly: { kind: "live", configured: true },
        functions: ["configure", "close"]
      },
      "obs:b:capture": {
        label: "Capture",
        catalog: "capture:file",
        status: ["running", null, 1] as const,
        settings: {},
        readonly: { configured: true, health: { status: "running" } },
        functions: ["configure", "close"]
      },
      "obs:b:run": {
        label: "Run",
        catalog: "system:run",
        status: ["running", null, 1] as const,
        settings: {},
        readonly: { prepared: true },
        functions: ["prepare", "start"]
      },
      "capture:file": {
        label: "File",
        catalog: "capture:file",
        status: ["idle", null, 1] as const,
        settings: {},
        readonly: {},
        functions: ["configure", "close"]
      },
      "sink:live": {
        label: "Live",
        catalog: "sink:live",
        status: ["configured", null, 1] as const,
        settings: { subscribe: ["publish.video.rendered"] },
        readonly: {},
        functions: ["configure", "close"]
      }
    }
  } as unknown as import("#run/control/board/index.js").Board;

  const fileSnapshot = (over?: Record<string, unknown>) => ({
    runId: "run_snapshot",
    lifecycle: "running" as const,
    controlRevision: 3,
    trackDepths: {},
    capture: {
      descriptorId: "file",
      sourceType: "file" as const,
      exhausted: false,
      eosAppended: false,
      health: {
        stage: "capture" as const,
        descriptorId: "file",
        status: "running" as const,
        updatedAtMs: 99,
        sourceId: "capture:file",
        frameCount: 7,
        droppedFrames: 0
      }
    },
    sinks: {
      live: { deliveredItems: 7, finalized: false }
    },
    ...over
  });

  it("routes capture facts to the owning observation cell, leaving sibling and global cells alone", () => {
    const next = applyWorkerSnapshotToBoard(ownerBoard, fileSnapshot(), "a");

    expect(next.cells["obs:a:capture"]?.readonly).toMatchObject({
      sourceType: "file",
      exhausted: false,
      eosAppended: false
    });
    // Sibling keeps its own facts; the legacy global cell is untouched.
    expect(next.cells["obs:b:capture"]?.readonly).toMatchObject({
      health: { status: "running" }
    });
    expect(next.cells["capture:file"]?.readonly ?? {}).not.toHaveProperty("sourceType");
  });

  it("routes sink facts to the owning publish cell with counters and final output", () => {
    const next = applyWorkerSnapshotToBoard(
      ownerBoard,
      fileSnapshot({
        lifecycle: "stopped" as const,
        sinks: {
          live: {
            deliveredItems: 9,
            finalized: true,
            finalizeResult: { output: { uri: "s3://out/clip.mp4" } }
          }
        }
      }),
      "a"
    );

    expect(next.cells["obs:a:publish"]?.readonly).toMatchObject({
      deliveredItems: 9,
      finalized: true,
      outputUri: "s3://out/clip.mp4"
    });
    // No second counter authority: the global stage cell stays untouched.
    expect(next.cells["sink:live"]?.readonly ?? {}).not.toHaveProperty("deliveredItems");
    // The observation's own run cell records the terminal status + reason.
    expect(next.cells["obs:a:run"]?.status[0]).toBe("stopped");
    expect(next.cells["obs:b:run"]?.status[0]).toBe("running");
  });

  it("keeps legacy global routing for runs without an observation", () => {
    const next = applyWorkerSnapshotToBoard(ownerBoard, fileSnapshot());

    expect(next.cells["capture:file"]?.readonly).toMatchObject({ sourceType: "file" });
    expect(next.cells["obs:a:capture"]?.readonly ?? {}).not.toHaveProperty("sourceType");
  });
});

describe("applyWorkerSnapshotToBoard terminal preservation", () => {
  const terminalBoard = (status: string, reason: string | null) =>
    ({
      revision: 5,
      catalogVersion: "0.1.0",
      cells: {
        "obs:a:run": {
          label: "Run",
          catalog: "system:run",
          status: [status, reason, 4] as const,
          settings: {},
          readonly: { prepared: true, outcome: "stopped" },
          functions: ["prepare", "start"]
        },
        "obs:a:capture": {
          label: "Capture",
          catalog: "capture:file",
          status: ["running", null, 1] as const,
          settings: {},
          readonly: { configured: true },
          functions: ["configure", "close"]
        },
        "obs:a:publish": {
          label: "Publish",
          catalog: "sink:live",
          status: ["configured", null, 1] as const,
          settings: { subscribe: ["publish.video.rendered"] },
          readonly: { kind: "live", configured: true },
          functions: ["configure", "close"]
        }
      }
    }) as unknown as import("#run/control/board/index.js").Board;

  const runningSnapshot = () => ({
    runId: "run_snapshot",
    lifecycle: "running" as const,
    controlRevision: 5,
    trackDepths: {},
    capture: {
      descriptorId: "file",
      sourceType: "file" as const,
      exhausted: false,
      eosAppended: false,
      health: {
        stage: "capture" as const,
        descriptorId: "file",
        status: "running" as const,
        updatedAtMs: 99,
        sourceId: "capture:file",
        frameCount: 11,
        droppedFrames: 0
      }
    },
    sinks: {
      live: { deliveredItems: 11, finalized: false }
    }
  });

  it("running snapshot over failed keeps the exact failed tuple but projects facts", () => {
    const next = applyWorkerSnapshotToBoard(
      terminalBoard("failed", "boom"),
      runningSnapshot(),
      "a"
    );

    expect(next.cells["obs:a:run"]?.status).toEqual(["failed", "boom", 4]);
    expect(next.cells["obs:a:capture"]?.readonly).toMatchObject({ sourceType: "file" });
    expect(next.cells["obs:a:publish"]?.readonly).toMatchObject({ deliveredItems: 11 });
  });

  it("stopped snapshot over failed keeps failed (no failed→stopped flip)", () => {
    const stopped = {
      ...runningSnapshot(),
      lifecycle: "stopped" as const,
      capture: { ...runningSnapshot().capture, exhausted: true, eosAppended: true }
    };
    const next = applyWorkerSnapshotToBoard(terminalBoard("failed", "boom"), stopped, "a");

    expect(next.cells["obs:a:run"]?.status[0]).toBe("failed");
    expect(next.cells["obs:a:run"]?.status[1]).toBe("boom");
  });

  it("failed snapshot over stopped keeps stopped", () => {
    const failed = { ...runningSnapshot(), lifecycle: "failed" as const, error: "late" };
    const next = applyWorkerSnapshotToBoard(terminalBoard("stopped", "done"), failed, "a");

    expect(next.cells["obs:a:run"]?.status[0]).toBe("stopped");
    expect(next.cells["obs:a:run"]?.status[1]).toBe("done");
  });
});
