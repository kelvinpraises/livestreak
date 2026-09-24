 
import type { BoardCell, BoardCellId } from "#run/control/bus/index.js";
import { defaultControlPause, defaultControlRun } from "./settings.js";

export type { BoardCell, BoardCellId, BoardCellStatus } from "#run/control/bus/index.js";

export interface Board {
  readonly revision: number;
  readonly catalogVersion: string;
  readonly cells: Readonly<Record<BoardCellId, BoardCell>>;
}

export type BoardRunStatus =
  | "created"
  | "preparing"
  | "prepared"
  | "starting"
  | "running"
  | "pausing"
  | "paused"
  | "resuming"
  | "draining"
  | "stopping"
  | "stopped"
  | "failed";

export interface CreateInitialBoardInput {
  readonly runId: string;
  readonly nowMs?: number;
}

export const createInitialBoard = (input: CreateInitialBoardInput): Board => {
  const nowMs = input.nowMs ?? Date.now();

  return {
    revision: 1,
    catalogVersion: "0.1.0",
    cells: {
      "system:config": {
        label: "Session",
        catalog: "system:config",
        status: ["idle", null, nowMs],
        settings: {},
        readonly: {
          runId: input.runId
        },
        functions: ["configure", "close", "remove", "publishKind"]
      }
    }
  };
};

export const incrementBoardRevision = (board: Board): Board => ({
  ...board,
  revision: board.revision + 1
});

/** The board's active run cell. Families key run cells obs:<id>:run; the kernel drives one run,
 *  so resolution prefers a runId match, then the sole family, then the legacy id. */
export const runCellIdOf = (board: Board, runId?: string, obsId?: string): string | undefined => {
  if (obsId !== undefined) {
    const direct = `obs:${obsId}:run`;
    return board.cells[direct] !== undefined ? direct : undefined;
  }
  const familyIds = Object.keys(board.cells).filter(
    (id) => id.startsWith("obs:") && id.endsWith(":run")
  );
  if (runId !== undefined) {
    const match = familyIds.find((id) => board.cells[id]?.readonly?.runId === runId);
    if (match !== undefined) {
      return match;
    }
  }
  if (familyIds.length === 1) {
    return familyIds[0];
  }
  if (board.cells["system:run"] !== undefined) {
    return "system:run";
  }
  return familyIds[0];
};

/** The board's active pause cell — same resolution rules as the run cell. */
export const pauseCellIdOf = (board: Board, runId?: string, obsId?: string): string | undefined => {
  if (obsId !== undefined) {
    const direct = `obs:${obsId}:pause`;
    return board.cells[direct] !== undefined ? direct : undefined;
  }
  const familyIds = Object.keys(board.cells).filter(
    (id) => id.startsWith("obs:") && id.endsWith(":pause")
  );
  if (runId !== undefined) {
    const runCellId = runCellIdOf(board, runId);
    const obsPrefix = runCellId?.startsWith("obs:") === true ? runCellId.slice(0, -":run".length) : undefined;
    const match = obsPrefix === undefined ? undefined : familyIds.find((id) => id.startsWith(obsPrefix));
    if (match !== undefined) {
      return match;
    }
  }
  if (familyIds.length === 1) {
    return familyIds[0];
  }
  if (board.cells["system:pause"] !== undefined) {
    return "system:pause";
  }
  return familyIds[0];
};

export const setBoardRunStatus = (
  board: Board,
  status: BoardRunStatus,
  message: string | null = null,
  nowMs: number = Date.now(),
  obsId?: string
): Board => {
  const runCellId = runCellIdOf(board, undefined, obsId);
  const runCell = runCellId === undefined ? undefined : board.cells[runCellId];
  if (runCellId === undefined || runCell === undefined) {
    return board;
  }

  return incrementBoardRevision({
    ...board,
    cells: {
      ...board.cells,
      [runCellId]: {
        ...runCell,
        status: [status, message, nowMs]
      }
    }
  });
};

/** Consume a stale stop request so a restarted run does not inherit the previous cycle's stop command. */
export const clearBoardRunStopRequest = (board: Board, obsId?: string): Board => {
  const runCellId = runCellIdOf(board, undefined, obsId);
  const runCell = runCellId === undefined ? undefined : board.cells[runCellId];
  if (runCellId === undefined || runCell?.settings?.stopRequested !== true) {
    return board;
  }

  const { stopReason: _stopReason, ...settings } = runCell.settings;

  return incrementBoardRevision({
    ...board,
    cells: {
      ...board.cells,
      [runCellId]: {
        ...runCell,
        settings: { ...settings, stopRequested: false }
      }
    }
  });
};

/** Read the run cell's prepared flag; undefined when the run cell (or flag) isn't on the board. */
export const readBoardRunPrepared = (board: Board, obsId?: string): boolean | undefined => {
  const runCellId = runCellIdOf(board, undefined, obsId);
  const prepared = runCellId === undefined ? undefined : board.cells[runCellId]?.readonly?.prepared;
  return typeof prepared === "boolean" ? prepared : undefined;
};

export const setBoardRunPrepared = (
  board: Board,
  prepared: boolean,
  manifestId?: string,
  obsId?: string
): Board => {
  const runCellId = runCellIdOf(board, undefined, obsId);
  const runCell = runCellId === undefined ? undefined : board.cells[runCellId];
  if (runCellId === undefined || runCell === undefined) {
    return board;
  }

  const readonly: Record<string, unknown> = runCell.readonly
    ? { ...runCell.readonly, prepared }
    : { prepared };
  if (manifestId !== undefined) {
    readonly.manifestId = manifestId;
  }

  return incrementBoardRevision({
    ...board,
    cells: {
      ...board.cells,
      [runCellId]: {
        ...runCell,
        readonly
      }
    }
  });
};
