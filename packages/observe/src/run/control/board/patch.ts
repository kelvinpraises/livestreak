import { Effect } from "effect";
import { LiveStreakConfigError } from "@livestreak/core";
import {
  incrementBoardRevision,
  readBoardRunPrepared,
  setBoardRunPrepared,
  setBoardRunStatus,
  type Board,
  type BoardCell
} from "#run/control/board/model.js";
import { validateBoardSettings } from "#run/control/board/settings.js";
import type {
  BoardCellId,
  BoardCellPatch,
  BoardCellStatus,
  BoardPatch,
  BoardSectionPatch
} from "#run/control/bus/index.js";

export type { BoardPatch, BoardCellPatch, BoardSectionPatch } from "#run/control/bus/index.js";

export interface ApplyBoardPatchResult {
  readonly board: Board;
  readonly changed: boolean;
}

export const applyBoardPatch = (
  board: Board,
  patch: BoardPatch
): Effect.Effect<ApplyBoardPatchResult, LiveStreakConfigError> =>
  Effect.gen(function* () {
    const cellPatches = patch.cells;
    if (cellPatches === undefined || Object.keys(cellPatches).length === 0) {
      return { board, changed: false };
    }

    let nextCells = { ...board.cells } as Record<BoardCellId, BoardCell>;
    let changed = false;
    let pipelineConfigChanged = false;
    const demoteObsIds = new Set<string>();
    let demoteLegacy = false;

    for (const [cellId, cellPatch] of Object.entries(cellPatches)) {
      if (cellPatch.remove === true) {
        if (nextCells[cellId] !== undefined) {
          const { [cellId]: _removed, ...rest } = nextCells;
          nextCells = rest as Record<BoardCellId, BoardCell>;
          changed = true;
          if (isPipelineCell(cellId)) pipelineConfigChanged = true;
        }
        continue;
      }

      const currentCell = nextCells[cellId];
      if (currentCell === undefined) {
        if (cellPatch.create === undefined) {
          return yield* Effect.fail(
            new LiveStreakConfigError({
              message: `Board patch targets unknown cell ${cellId}`
            })
          );
        }

        yield* validateCellPatch(cellPatch);
        nextCells = { ...nextCells, [cellId]: cellPatch.create };
        changed = true;
        continue;
      }

      yield* validateCellPatch(cellPatch);

      const patched = patchBoardCell(currentCell, cellPatch);
      if (patched.changed) {
        nextCells = { ...nextCells, [cellId]: patched.cell };
        changed = true;
        if (patchTouchesPipelineConfig(cellId, cellPatch)) {
          pipelineConfigChanged = true;
          const kind = familyKind(cellId);
          if (kind !== undefined) {
            demoteObsIds.add(cellId.split(":")[1] ?? "");
          } else {
            demoteLegacy = true;
          }
        }
      }
    }

    if (!changed) {
      return { board, changed: false };
    }

    let nextBoard = incrementBoardRevision({
      ...board,
      cells: nextCells
    });

    // Prepared is a derivation of the board: a pipeline config change makes it stale, so the
    // run cell demotes honestly instead of letting start run the OLD config. Start re-prepares.
    // The demote targets the TOUCHED family's run cell only — a sibling observation's config
    // change never demotes another family's run.
    if (pipelineConfigChanged) {
      const targets: (string | undefined)[] = [
        ...(demoteLegacy ? [undefined] : []),
        ...demoteObsIds
      ];
      for (const obsId of targets) {
        if (readBoardRunPrepared(nextBoard, obsId) === true) {
          nextBoard = setBoardRunPrepared(nextBoard, false, undefined, obsId);
          nextBoard = setBoardRunStatus(
            nextBoard,
            "created",
            "configuration changed — Start will re-prepare",
            Date.now(),
            obsId
          );
        }
      }
    }

    // Shape-only on live patches (see settings.ts): a configure write validates the SHAPE of what it wrote,
    // but the cross-cell ≥1-sink COMPLETENESS rule is a go-live prerequisite the kernel enforces at prepare
    // (with requireComplete defaulting true). Enforcing completeness on every patch traps the operator who
    // configures the capture cell before the sink cell ("At least one sink policy is required").
    if (patchChangesSettings(patch)) {
      yield* validateBoardSettings(nextBoard, { requireComplete: false });
    }

    return {
      board: nextBoard,
      changed: true
    };
  });

// --- helpers ---

// Cells whose config feeds runConfigFromBoard: capture/sink settings, and the market cell's
// marketId (the direct lane's streamId). Changes to these invalidate a prepared run.
// Family ids key obs:<id>:<kind>; legacy stage cells keep the old prefixes.
const familyKind = (cellId: string): string | undefined => {
  const parts = cellId.split(":");
  return parts[0] === "obs" && parts.length === 3 ? parts[2] : undefined;
};

const isPipelineCell = (cellId: string): boolean => {
  const kind = familyKind(cellId);
  if (kind !== undefined) {
    return kind === "capture" || kind === "publish";
  }
  return cellId.startsWith("capture:") || cellId.startsWith("sink:");
};

const patchTouchesPipelineConfig = (cellId: string, patch: BoardCellPatch): boolean => {
  if (isPipelineCell(cellId)) {
    return patch.settings !== undefined;
  }
  if (cellId === "market" || familyKind(cellId) === "market") {
    return patch.readonly?.set !== undefined && Object.hasOwn(patch.readonly.set, "marketId");
  }
  return false;
};

const patchBoardCell = (
  cell: BoardCell,
  patch: BoardCellPatch
): { readonly cell: BoardCell; readonly changed: boolean } => {
  let changed = false;
  let nextCell = cell;

  if (patch.settings !== undefined) {
    const result = applySectionPatch(cell.settings ?? {}, patch.settings);
    if (result.changed) {
      nextCell = { ...nextCell, settings: result.value };
      changed = true;
    }
  }

  if (patch.readonly !== undefined) {
    const result = applySectionPatch(cell.readonly ?? {}, patch.readonly);
    if (result.changed) {
      nextCell = { ...nextCell, readonly: result.value };
      changed = true;
    }
  }

  if (patch.refs !== undefined) {
    const result = applySectionPatch(cell.refs ?? {}, patch.refs);
    if (result.changed) {
      nextCell = {
        ...nextCell,
        refs: result.value as Readonly<Record<string, string>>
      };
      changed = true;
    }
  }

  if (patch.status !== undefined && !statusEqual(cell.status, patch.status)) {
    nextCell = { ...nextCell, status: patch.status };
    changed = true;
  }

  if (patch.label !== undefined && patch.label !== cell.label) {
    nextCell = { ...nextCell, label: patch.label };
    changed = true;
  }

  if (patch.catalog !== undefined && patch.catalog !== cell.catalog) {
    nextCell = { ...nextCell, catalog: patch.catalog };
    changed = true;
  }

  if (patch.functions !== undefined && !functionsEqual(cell.functions, patch.functions)) {
    nextCell = { ...nextCell, functions: [...patch.functions] };
    changed = true;
  }

  return { cell: nextCell, changed };
};

const functionsEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const applySectionPatch = (
  current: Readonly<Record<string, unknown>>,
  patch: BoardSectionPatch
): { readonly value: Readonly<Record<string, unknown>>; readonly changed: boolean } => {
  const next = { ...current } as Record<string, unknown>;
  let changed = false;

  if (patch.set !== undefined) {
    for (const [key, value] of Object.entries(patch.set)) {
      if (!isJsonEqual(next[key], value)) {
        next[key] = value;
        changed = true;
      }
    }
  }

  if (patch.unset !== undefined) {
    for (const key of patch.unset) {
      if (Object.hasOwn(next, key)) {
        delete next[key];
        changed = true;
      }
    }
  }

  return { value: next, changed };
};

const validateCellPatch = (
  patch: BoardCellPatch
): Effect.Effect<void, LiveStreakConfigError> => {
  const overlaps = [
    ...findPatchKeyOverlap(patch.settings),
    ...findPatchKeyOverlap(patch.readonly),
    ...findPatchKeyOverlap(patch.refs)
  ];

  if (overlaps.length > 0) {
    return Effect.fail(
      new LiveStreakConfigError({
        message: "Board patch cannot set and unset the same keys",
        metadata: { cause: { keys: overlaps } }
      })
    );
  }

  return Effect.void;
};

const findPatchKeyOverlap = (section: BoardSectionPatch | undefined): readonly string[] => {
  if (section?.set === undefined || section.unset === undefined) {
    return [];
  }

  const unsetKeys = section.unset;
  return Object.keys(section.set).filter((key) => unsetKeys.includes(key));
};

const statusEqual = (left: BoardCellStatus, right: BoardCellStatus): boolean =>
  left[0] === right[0] && left[1] === right[1] && left[2] === right[2];

const isJsonEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }

  if (left === null || right === null || typeof left !== typeof right) {
    return false;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => isJsonEqual(item, right[index]))
    );
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);

    return (
      leftKeys.length === Object.keys(right).length &&
      leftKeys.every(
        (key) => Object.hasOwn(right, key) && isJsonEqual(left[key], right[key])
      )
    );
  }

  return false;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const patchChangesSettings = (patch: BoardPatch): boolean => {
  const cellPatches = patch.cells;
  if (cellPatches === undefined) {
    return false;
  }

  for (const cellPatch of Object.values(cellPatches)) {
    if (cellPatch.settings !== undefined) {
      return true;
    }
  }

  return false;
};

export const boardSettingsChanged = (before: Board, after: Board): boolean => {
  for (const [cellId, cell] of Object.entries(after.cells)) {
    const beforeSettings = before.cells[cellId]?.settings;
    if (!isJsonEqual(beforeSettings ?? {}, cell.settings ?? {})) {
      return true;
    }
  }

  return false;
};
