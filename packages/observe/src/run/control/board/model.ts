/* eslint-disable unicorn/no-null -- BoardCell.status tuple uses null for absent message */
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
      "system:run": {
        label: "Run",
        catalog: "system:run",
        status: ["created", null, nowMs],
        settings: { ...defaultControlRun },
        readonly: {
          runId: input.runId,
          prepared: false
        },
        functions: ["stop"]
      },
      "system:pause": {
        label: "Pause",
        catalog: "system:pause",
        status: ["idle", null, nowMs],
        settings: { ...defaultControlPause },
        functions: ["pause", "resume", "setPresentation"]
      },
      "system:memory": {
        label: "Memory",
        catalog: "system:memory",
        status: ["idle", null, nowMs],
        readonly: {},
        functions: []
      },
      "system:tick": {
        label: "Tick",
        catalog: "system:tick",
        status: ["idle", null, nowMs],
        readonly: {},
        functions: []
      },
      market: {
        label: "Market",
        catalog: "market",
        status: ["none", null, nowMs],
    readonly: {
      registrationState: "none"
    },
        functions: []
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
