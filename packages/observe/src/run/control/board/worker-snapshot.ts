import type { WorkerSnapshot } from "#run/worker/snapshot.js";
import {
  incrementBoardRevision,
  type Board,
  type BoardRunStatus
} from "#run/control/board/model.js";

export const applyWorkerSnapshotToBoard = (
  board: Board,
  snapshot: WorkerSnapshot
): Board => {
  const runCell = board.cells["system:run"];
  if (runCell === undefined) {
    return board;
  }

  const currentStatus = (runCell.status[0] ?? "created") as BoardRunStatus;
  const nextStatus = boardRunStatusFromWorkerSnapshot(snapshot, currentStatus);

  let nextBoard = board;
  let changed = false;

  if (nextStatus !== currentStatus) {
    const nextReason = statusReasonFromWorkerSnapshot(
      snapshot,
      nextStatus,
      runCell.status[1],
      board
    );
    nextBoard = {
      ...nextBoard,
      cells: {
        ...nextBoard.cells,
        "system:run": {
          ...runCell,
          status: [nextStatus, nextReason, Date.now()]
        }
      }
    };
    changed = true;
  }

  const changedReference = { value: changed };
  nextBoard = projectCaptureReadonlyFacts(nextBoard, snapshot, changedReference);
  nextBoard = projectSinkReadonlyFacts(nextBoard, snapshot, changedReference);
  changed = changedReference.value;

  if (!changed) {
    return board;
  }

  return incrementBoardRevision(nextBoard);
};

// --- helpers ---

const boardRunStatusFromWorkerSnapshot = (
  snapshot: WorkerSnapshot,
  currentStatus: BoardRunStatus
): BoardRunStatus => {
  if (isTerminalBoardRunStatus(currentStatus)) {
    if (snapshot.lifecycle === "failed") {
      return "failed";
    }
    if (snapshot.lifecycle === "stopped") {
      return "stopped";
    }
    return currentStatus;
  }

  if (snapshot.lifecycle === "failed") {
    return "failed";
  }

  if (snapshot.lifecycle === "stopped") {
    return "stopped";
  }

  if (snapshot.lifecycle === "idle") {
    return currentStatus === "starting" ? "starting" : currentStatus;
  }

  return workerLifecycleToBoardStatus(snapshot.lifecycle);
};

const workerLifecycleToBoardStatus = (
  lifecycle: WorkerSnapshot["lifecycle"]
): BoardRunStatus => {
  switch (lifecycle) {
    case "running": {
      return "running";
    }
    case "pausing": {
      return "pausing";
    }
    case "paused": {
      return "paused";
    }
    case "resuming": {
      return "resuming";
    }
    case "stopping": {
      return "stopping";
    }
    case "draining": {
      return "draining";
    }
    case "failed": {
      return "failed";
    }
    case "stopped": {
      return "stopped";
    }
    default: {
      return "running";
    }
  }
};

const isTerminalBoardRunStatus = (status: BoardRunStatus): boolean =>
  status === "stopped" || status === "failed";

const statusReasonFromWorkerSnapshot = (
  snapshot: WorkerSnapshot,
  nextStatus: BoardRunStatus,
  currentReason: string | null,
  board: Board
): string | null => {
  if (nextStatus === "draining") {
    const runSettings = board.cells["system:run"]?.settings;
    if (runSettings?.stopRequested === true) {
      if (typeof runSettings.stopReason === "string") {
        return runSettings.stopReason;
      }
      return "stop requested";
    }

    return "capture reached end of stream";
  }

  if (nextStatus === "stopping") {
    const runSettings = board.cells["system:run"]?.settings;
    if (typeof runSettings?.stopReason === "string") {
      return runSettings.stopReason;
    }
    return "stop requested";
  }

  if (nextStatus === "paused") {
    return "capture paused";
  }

  if (nextStatus === "pausing") {
    return "capture pausing";
  }

  if (nextStatus === "resuming") {
    return "capture resuming";
  }

  if (nextStatus === "running") {
    return "worker is active";
  }

  if (nextStatus === "stopped") {
    return "worker exited cleanly";
  }

  if (nextStatus === "failed") {
    if (snapshot.error !== undefined) {
      return snapshot.error;
    }
    return "worker failed";
  }

  return currentReason;
};

const projectCaptureReadonlyFacts = (
  board: Board,
  snapshot: WorkerSnapshot,
  changed: { value: boolean }
): Board => {
  const capture = snapshot.capture;
  if (capture === undefined) {
    return board;
  }

  const cellId = capture.sourceType === "browser" ? "capture:browser" : "capture:file";
  const cell = board.cells[cellId];
  if (cell === undefined) {
    return board;
  }

  const readonly = {
    ...cell.readonly,
    sourceType: capture.sourceType,
    health: capture.health,
    exhausted: capture.exhausted,
    eosAppended: capture.eosAppended
  };

  if (jsonEqual(cell.readonly ?? {}, readonly)) {
    return board;
  }

  changed.value = true;
  return {
    ...board,
    cells: {
      ...board.cells,
      [cellId]: {
        ...cell,
        readonly
      }
    }
  };
};

const projectSinkReadonlyFacts = (
  board: Board,
  snapshot: WorkerSnapshot,
  changed: { value: boolean }
): Board => {
  let nextBoard = board;

  for (const [sinkId, sinkSnapshot] of Object.entries(snapshot.sinks)) {
    const cellId = `sink:${sinkId}`;
    const cell = nextBoard.cells[cellId];
    if (cell === undefined) {
      continue;
    }

    const readonly = {
      ...cell.readonly,
      deliveredItems: sinkSnapshot.deliveredItems,
      finalized: sinkSnapshot.finalized,
      ...(sinkSnapshot.finalizeResult?.output?.uri === undefined
        ? {}
        : { outputUri: sinkSnapshot.finalizeResult.output.uri })
    };

    if (jsonEqual(cell.readonly ?? {}, readonly)) {
      continue;
    }

    changed.value = true;
    nextBoard = {
      ...nextBoard,
      cells: {
        ...nextBoard.cells,
        [cellId]: {
          ...cell,
          readonly
        }
      }
    };
  }

  return nextBoard;
};

const jsonEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }

  if (left === null || right === null || typeof left !== typeof right) {
    return false;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => jsonEqual(item, right[index]))
    );
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);

    return (
      leftKeys.length === Object.keys(right).length &&
      leftKeys.every(
        (key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key])
      )
    );
  }

  return false;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
