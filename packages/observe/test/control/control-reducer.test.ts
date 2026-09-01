/* eslint-disable unicorn/no-null -- BoardCell.status tuple uses null for absent message */
import { describe, expect, it } from "vitest";
import { applyWorkerSnapshotToBoard } from "#run/control/board/index.js";
import { createInitialBoard } from "#run/control/board/index.js";
import type { WorkerSnapshot } from "#run/worker/snapshot.js";

describe("applyWorkerSnapshotToBoard", () => {
  const baseBoard = createInitialBoard({
    runId: "run_test"
  });

  const runningBoard = {
    ...baseBoard,
    revision: 3,
    cells: {
      ...baseBoard.cells,
      "system:run": {
        ...baseBoard.cells["system:run"],
        status: ["running", null, Date.now()] as const
      }
    }
  };

  it("mirrors natural drain and increments revision", () => {
    const next = applyWorkerSnapshotToBoard(runningBoard, makeSnapshot("draining"));

    expect(next.cells["system:run"]?.status[0]).toBe("draining");
    expect(next.revision).toBe(4);
    expect(next.cells["system:run"]?.status[1]).toBe("capture reached end of stream");
  });

  it("mirrors commanded stop drain with stop reason", () => {
    const stopBoard = {
      ...runningBoard,
      cells: {
        ...runningBoard.cells,
        "system:run": {
          ...runningBoard.cells["system:run"]!,
          settings: {
            stopRequested: true,
            stopReason: "operator request"
          }
        }
      }
    };

    const next = applyWorkerSnapshotToBoard(stopBoard, makeSnapshot("draining"));

    expect(next.cells["system:run"]?.status[0]).toBe("draining");
    expect(next.cells["system:run"]?.status[1]).toBe("operator request");
  });

  it("mirrors commanded stop drain with fallback reason", () => {
    const stopBoard = {
      ...runningBoard,
      cells: {
        ...runningBoard.cells,
        "system:run": {
          ...runningBoard.cells["system:run"]!,
          settings: {
            stopRequested: true
          }
        }
      }
    };

    const next = applyWorkerSnapshotToBoard(stopBoard, makeSnapshot("draining"));

    expect(next.cells["system:run"]?.status[1]).toBe("stop requested");
  });

  it("mirrors stopped and increments revision again", () => {
    const draining = applyWorkerSnapshotToBoard(runningBoard, makeSnapshot("draining"));
    const next = applyWorkerSnapshotToBoard(draining, makeSnapshot("stopped"));

    expect(next.cells["system:run"]?.status[0]).toBe("stopped");
    expect(next.revision).toBe(5);
    expect(next.cells["system:run"]?.status[1]).toBe("worker exited cleanly");
  });

  it("leaves board unchanged when worker lifecycle has no projection", () => {
    const next = applyWorkerSnapshotToBoard(runningBoard, makeSnapshot("running"));
    expect(next).toBe(runningBoard);
  });

  it("does not regress terminal run status from a stale draining snapshot", () => {
    const stopped = applyWorkerSnapshotToBoard(runningBoard, makeSnapshot("stopped"));
    const next = applyWorkerSnapshotToBoard(stopped, makeSnapshot("draining"));

    expect(next.cells["system:run"]?.status[0]).toBe("stopped");
    expect(next.revision).toBe(stopped.revision);
  });
});

// --- helpers ---

const makeSnapshot = (lifecycle: WorkerSnapshot["lifecycle"]): WorkerSnapshot => ({
  runId: "run_test",
  lifecycle,
  controlRevision: 3,
  trackDepths: {},
  capture:
    lifecycle === "running"
      ? undefined
      : {
          descriptorId: "file",
          sourceType: "file",
          exhausted: true,
          eosAppended: true
        },
  sinks: {}
});
