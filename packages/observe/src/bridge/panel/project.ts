import type { Board } from "#run/control/board/index.js";
import type { CatalogFunction, ControlCatalog } from "#run/control/index.js";
import type { ControlPanel } from "#run/control/bus/index.js";
import type { ControlCellView, ControlFunctionView, ControlsView } from "./types.js";
import { readLiveConfigurators } from "#run/control/board/visibility.js";

export type { ControlCellView, ControlFunctionView, ControlsView } from "./types.js";

const SYSTEM_CELL_ORDER = [
  "system:config",
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
  const liveConfigurators = readLiveConfigurators(board);
  const sortedCellIds = sortCellIds(Object.keys(board.cells)).filter((cellId) =>
    isCellVisibleOnBoard(cellId, liveConfigurators)
  );

  return {
    runId: readBoardRunId(board),
    revision: board.revision,
    cells: sortedCellIds.map((id, order) =>
      projectCellView(id, board.cells[id], order, catalog, runState, liveConfigurators)
    )
  };
};

const isCellVisibleOnBoard = (cellId: string, liveConfigurators: readonly string[]): boolean => {
  if (cellId === "system:config") {
    return liveConfigurators.includes("observe.system.config");
  }

  if (cellId === "system:run") {
    return liveConfigurators.includes("observe.system.run");
  }

  if (cellId === "market") {
    return liveConfigurators.includes("observe.market");
  }

  if (cellId.startsWith("capture:")) {
    return liveConfigurators.includes(`observe.capture.${cellId.slice("capture:".length)}`);
  }

  if (cellId.startsWith("sink:")) {
    return liveConfigurators.includes(`observe.sink.${cellId.slice("sink:".length)}`);
  }

  if (cellId.startsWith("system:")) {
    return liveConfigurators.length > 1;
  }

  return true;
};

const projectCellView = (
  id: string,
  cell: Board["cells"][string],
  order: number,
  catalog: ControlCatalog | undefined,
  runState: string | undefined,
  liveConfigurators: readonly string[]
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
    functions: cell.functions
      .filter((name) => isFunctionVisibleOnCell(id, name, cell, liveConfigurators))
      .map((name) =>
        applyDisabledState(projectFunctionView(id, cell.catalog, name, catalog), state, runState)
      )
  };
};

// A configurator cell's `close` tears down that cell's mounted configuration; it is meaningless (and
// confused live operators) on a cell that was never configured. So `close` stays hidden until the cell
// carries real config: system:config while it is still at the pristine `idle` root level, and the
// pipeline cells (capture:* / sink:*) until their own `configure` flips readonly.configured to true.
const cellHasBeenConfigured = (cellId: string, cell: Board["cells"][string]): boolean => {
  if (cellId === "system:config") {
    return cell.status[0] === "configured";
  }
  if (cellId.startsWith("capture:") || cellId.startsWith("sink:")) {
    return cell.readonly?.configured === true;
  }
  // market / system:run etc. are not configure/close configurators — their own actions gate themselves.
  return true;
};

const isFunctionVisibleOnCell = (
  cellId: string,
  fnName: string,
  cell: Board["cells"][string],
  liveConfigurators: readonly string[]
): boolean => {
  if (cellId === "system:config" && fnName === "configure") {
    return liveConfigurators.includes("observe.system.config");
  }

  if (fnName === "close") {
    if (cellId === "system:config" && !liveConfigurators.includes("observe.system.config")) {
      return false;
    }
    return cellHasBeenConfigured(cellId, cell);
  }

  return true;
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

  // The control catalog is keyed by CELL ID (capture:file, sink:file-export, sink:live, system:config,
  // market …), so the cell id is the canonical lookup key. `cell.catalog` (the catalog/kind identity) only
  // coincides with the cell id for most cells — the file sink diverges (cell id `sink:file-export` vs
  // catalog `sink:file`). Prefer the cell id so the file sink's configure resolves its `input` schema
  // (the `path` field) instead of falling through fieldless; fall back to `cell.catalog` for safety.
  const catalogFunction =
    catalog?.cells[cellId]?.functions[name] ??
    (catalogKey === undefined ? undefined : catalog?.cells[catalogKey]?.functions[name]);

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
  const fromRun = board.cells["system:run"]?.readonly?.runId;
  if (typeof fromRun === "string" && fromRun.length > 0) {
    return fromRun;
  }

  const fromConfig = board.cells["system:config"]?.readonly?.runId;
  return typeof fromConfig === "string" ? fromConfig : "";
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

  if (cellId === "market") {
    return 5;
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
