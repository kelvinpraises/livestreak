import type { Board } from "#run/control/board/index.js";
import { incrementBoardRevision } from "#run/control/board/index.js";
import type { BoardCell, ControlCellDefinition } from "./types.js";

export interface MergeBoardCellOnSurfaceMountResult {
  readonly board: Board;
  readonly changed: boolean;
}

export const mergeBoardCellOnSurfaceMount = (
  board: Board,
  definition: ControlCellDefinition
): MergeBoardCellOnSurfaceMountResult => {
  const existingCell = board.cells[definition.id];

  if (existingCell === undefined) {
    return {
      board: incrementBoardRevision({
        ...board,
        cells: {
          ...board.cells,
          [definition.id]: definition.cell
        }
      }),
      changed: true
    };
  }

  if (structuralMetadataEqual(existingCell, definition.cell)) {
    return { board, changed: false };
  }

  return {
    board: incrementBoardRevision({
      ...board,
      cells: {
        ...board.cells,
        [definition.id]: mergeExistingBoardCell(existingCell, definition.cell)
      }
    }),
    changed: true
  };
};

const structuralMetadataEqual = (existing: BoardCell, incoming: BoardCell): boolean =>
  existing.label === incoming.label &&
  existing.catalog === incoming.catalog &&
  functionsEqual(existing.functions, incoming.functions);

const functionsEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const mergeExistingBoardCell = (existing: BoardCell, incoming: BoardCell): BoardCell => ({
  ...existing,
  label: incoming.label,
  catalog: incoming.catalog,
  functions: incoming.functions
});
