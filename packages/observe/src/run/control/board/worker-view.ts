import type { Board, BoardRunStatus } from "#run/control/board/model.js";
import type { PausePresentation } from "#pipeline/capture/index.js";
import { isPausePresentation } from "#pipeline/capture/index.js";
import { defaultControlPause } from "./settings.js";

export type ControlRunStatus = BoardRunStatus;

export interface WorkerControlPause {
  readonly requested: boolean;
  readonly whilePaused: PausePresentation;
  readonly slateAssetId?: string;
}

export interface WorkerControlSinkPolicy {
  readonly sinkId: string;
  readonly kind: string;
  readonly subscribe: readonly string[];
  readonly required: boolean;
}

export interface WorkerControlRun {
  readonly stopRequested: boolean;
  readonly stopReason?: string;
}

export interface WorkerControlView {
  readonly revision: number;
  readonly status: ControlRunStatus;
  readonly statusReason?: string;
  readonly run: WorkerControlRun;
  readonly pause: WorkerControlPause;
  readonly process: null;
  readonly sinks: readonly WorkerControlSinkPolicy[];
}

export const projectWorkerControlView = (board: Board): WorkerControlView => {
  const runCell = board.cells["system:run"];
  const pauseCell = board.cells["system:pause"];

  const status = (runCell?.status[0] ?? "created") as ControlRunStatus;
  const statusReason = runCell?.status[1] ?? undefined;
  const pauseSettings = pauseCell?.settings ?? {};
  const whilePaused = isPausePresentation(pauseSettings.whilePaused)
    ? pauseSettings.whilePaused
    : defaultControlPause.whilePaused;

  const runSettings = runCell?.settings ?? {};

  return {
    revision: board.revision,
    status,
    statusReason: statusReason === null ? undefined : statusReason,
    run: {
      stopRequested: runSettings.stopRequested === true,
      ...(typeof runSettings.stopReason === "string"
        ? { stopReason: runSettings.stopReason }
        : {})
    },
    pause: {
      requested: pauseSettings.requested === true,
      whilePaused,
      ...(whilePaused === "slate" && typeof pauseSettings.slateAssetId === "string"
        ? { slateAssetId: pauseSettings.slateAssetId }
        : {})
    },
    // eslint-disable-next-line unicorn/no-null -- passthrough signal
    process: null,
    sinks: projectSinkPolicies(board)
  };
};

const projectSinkPolicies = (board: Board): readonly WorkerControlSinkPolicy[] => {
  const policies: WorkerControlSinkPolicy[] = [];

  for (const [cellId, cell] of Object.entries(board.cells)) {
    if (!cellId.startsWith("sink:")) {
      continue;
    }

    const settings = cell.settings ?? {};
    const subscribe = settings.subscribe;
    if (!Array.isArray(subscribe)) {
      continue;
    }

    policies.push({
      sinkId: cellId.slice("sink:".length),
      kind: catalogKindToSinkKind(cell.catalog),
      subscribe: subscribe.filter((entry): entry is string => typeof entry === "string"),
      required: settings.required === true
    });
  }

  return policies;
};

const catalogKindToSinkKind = (catalog: string | undefined): string => {
  if (catalog === "sink:file") {
    return "file";
  }
  return "unknown";
};
