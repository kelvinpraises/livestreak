 
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
        label: "Config",
        catalog: "system:config",
        status: ["idle", null, nowMs],
        settings: {},
        readonly: {
          runId: input.runId,
          liveConfigurators: ["observe.system.config"]
        },
        functions: ["configure", "close"]
      }
    }
  };
};

export const incrementBoardRevision = (board: Board): Board => ({
  ...board,
  revision: board.revision + 1
});

export const setBoardRunStatus = (
  board: Board,
  status: BoardRunStatus,
  message: string | null = null,
  nowMs: number = Date.now()
): Board => {
  const runCell = board.cells["system:run"];
  if (runCell === undefined) {
    return board;
  }

  return incrementBoardRevision({
    ...board,
    cells: {
      ...board.cells,
      "system:run": {
        ...runCell,
        status: [status, message, nowMs]
      }
    }
  });
};

/** Consume a stale stop request so a restarted run does not inherit the previous cycle's stop command. */
export const clearBoardRunStopRequest = (board: Board): Board => {
  const runCell = board.cells["system:run"];
  if (runCell?.settings?.stopRequested !== true) {
    return board;
  }

  const { stopReason: _stopReason, ...settings } = runCell.settings;

  return incrementBoardRevision({
    ...board,
    cells: {
      ...board.cells,
      "system:run": {
        ...runCell,
        settings: { ...settings, stopRequested: false }
      }
    }
  });
};

export const setBoardRunPrepared = (
  board: Board,
  prepared: boolean,
  manifestId?: string
): Board => {
  const runCell = board.cells["system:run"];
  if (runCell === undefined) {
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
      "system:run": {
        ...runCell,
        readonly
      }
    }
  });
};
