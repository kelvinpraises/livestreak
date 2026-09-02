import type { Board } from "#run/control/board/index.js";
import type { CatalogFunction, ControlCatalog } from "#run/control/index.js";
import type { ControlPanel } from "#run/control/bus/index.js";
import type { ControlCellView, ControlFunctionView, ControlsView } from "./types.js";

export type { ControlCellView, ControlFunctionView, ControlsView } from "./types.js";

const SYSTEM_CELL_ORDER = [
  "system:run",
  "system:pause",
  "system:memory",
  "system:tick"
] as const;

const TERMINAL_RUN_STATES = new Set(["stopped", "failed"]);

export const projectBoardControls = (board: Board): ControlsView =>
  projectControls(board);

export const projectControlPanelControls = (panel: ControlPanel): ControlsView =>
  projectControls(panel.board, panel.catalog);

const projectReferences = (
  references: Readonly<Record<string, unknown>> | undefined
): Readonly<Record<string, string>> => {
  if (references === undefined) {
    return {};
  }

  const projected: Record<string, string> = {};
  for (const [key, value] of Object.entries(references)) {
    if (typeof value === "string") {
      projected[key] = value;
    }
  }

  return projected;
};

const projectControls = (board: Board, catalog?: ControlCatalog): ControlsView => {
  const runState = readRunState(board);
  const sortedCellIds = sortCellIds(Object.keys(board.cells));

  return {
    runId: readBoardRunId(board),
    revision: board.revision,
    cells: sortedCellIds.map((id, order) =>
      projectCellView(id, board.cells[id], order, catalog, runState)
    )
  };
};

const projectCellView = (
  id: string,
  cell: Board["cells"][string],
  order: number,
  catalog: ControlCatalog | undefined,
  runState: string | undefined
): ControlCellView => {
  const [state, message, updatedAtMs] = cell.status;

  return {
    id,
    kind: cellKind(id),
    ...(cell.catalog === undefined ? {} : { catalog: cell.catalog }),
    label: cell.label,
    order,
    status: cell.status,
    state,
    message,
    updatedAtMs,
    settings: cloneJsonRecord(cell.settings),
    readonly: cloneJsonRecord(cell.readonly),
    refs: projectReferences(cell.refs),
    functions: cell.functions.map((name) =>
      applyDisabledState(
        projectFunctionView(id, cell.catalog, name, catalog),
        state,
        runState
      )
    )
  };
};

const projectFunctionView = (
  cellId: string,
  catalogKey: string | undefined,
  name: string,
  catalog: ControlCatalog | undefined
): ControlFunctionView => {
  const derived: ControlFunctionView = {
    name,
    scope: `${catalogKey ?? cellId}:${name}`,
    disabled: false
  };

  const catalogFunction = catalog?.cells[catalogKey ?? cellId]?.functions[name];

  if (catalogFunction === undefined) {
    return derived;
  }

  return mergeCatalogFunction(derived, catalogFunction);
};

const mergeCatalogFunction = (
  functionView: ControlFunctionView,
  catalogFunction: CatalogFunction
): ControlFunctionView => ({
  ...functionView,
  scope: catalogFunction.scope,
  label: catalogFunction.label,
  description: catalogFunction.description,
  resultKind: catalogFunction.result,
  ...(catalogFunction.input === undefined ? {} : { input: catalogFunction.input }),
  ...(catalogFunction.output === undefined ? {} : { output: catalogFunction.output })
});

const applyDisabledState = (
  functionView: ControlFunctionView,
  cellState: string,
  runState: string | undefined
): ControlFunctionView => {
  const { disabled, disabledReason } = deriveDisabled(functionView, cellState, runState);

  if (disabled) {
    return {
      ...functionView,
      disabled: true,
      disabledReason
    };
  }

  return {
    ...functionView,
    disabled: false
  };
};

const deriveDisabled = (
  functionView: ControlFunctionView,
  cellState: string,
  runState: string | undefined
): Pick<ControlFunctionView, "disabled" | "disabledReason"> => {
  if (cellState === "failed") {
    return { disabled: true, disabledReason: "Cell is failed" };
  }

  if (runState !== undefined && TERMINAL_RUN_STATES.has(runState) && isMutatingResultKind(functionView.resultKind)) {
    return {
      disabled: true,
      disabledReason: runState === "failed" ? "Run failed" : "Run is stopped"
    };
  }

  return { disabled: false };
};

const MUTATING_RESULT_KINDS = new Set(["patch", "patch+artifact", "state-patch"]);

const isMutatingResultKind = (resultKind: string | undefined): boolean =>
  resultKind !== undefined && MUTATING_RESULT_KINDS.has(resultKind);

const readBoardRunId = (board: Board): string => {
  const runId = board.cells["system:run"]?.readonly?.runId;
  return typeof runId === "string" ? runId : "";
};

const readRunState = (board: Board): string | undefined => {
  const state = board.cells["system:run"]?.status[0];
  return typeof state === "string" ? state : undefined;
};

const cellKind = (cellId: string): string => cellId.split(":", 1)[0] ?? "unknown";

const cellGroupOrder = (cellId: string): number => {
  if (cellId.startsWith("system:")) {
    return 0;
  }
  if (cellId.startsWith("capture:")) {
    return 1;
  }
  if (cellId.startsWith("process:")) {
    return 2;
  }
  if (cellId.startsWith("sink:") || cellId.startsWith("publish:")) {
    return 3;
  }

  return 4;
};

const sortCellIds = (cellIds: readonly string[]): readonly string[] =>
   
  [...cellIds].sort((left: string, right: string) => {
    const groupDiff = cellGroupOrder(left) - cellGroupOrder(right);
    if (groupDiff !== 0) {
      return groupDiff;
    }

    if (cellGroupOrder(left) === 0) {
      const leftOrder = systemCellOrder(left);
      const rightOrder = systemCellOrder(right);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
    }

    return left.localeCompare(right);
  });

const systemCellOrder = (cellId: string): number => {
  const index = SYSTEM_CELL_ORDER.indexOf(cellId as (typeof SYSTEM_CELL_ORDER)[number]);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const cloneJsonRecord = (
  value: Readonly<Record<string, unknown>> | undefined
): Readonly<Record<string, unknown>> => (value === undefined ? {} : { ...value });
