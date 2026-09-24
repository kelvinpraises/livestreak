// Gateway-injected bootstrap: PackageRuntimeInit → a live observe runtime with the T0 shell run
// mounted (pristine board, system:config + market lifecycle wired). The runtime lives in a
// process-lifetime scope so the streaming worker forked by startRun survives across dispatch calls.
// Effect-typed (observe src stays runPromise-free); the promise boundary is the consumer's.

import { Effect, Scope, Exit } from "effect";
import { runCellIdOf } from "#run/control/board/index.js";
import type { LiveStreakError } from "@livestreak/core";
import type { PackageRuntimeInit } from "@livestreak/schema";

import { makeObserveRun } from "#run/run.js";
import { shellRunConfig } from "#run/config/helpers.js";
import { mountObserveT0Bus } from "#run/board-first.js";
import type { Board, BoardRunStatus } from "#run/control/board/index.js";
import { createObserveRuntime, type ObserveRuntime } from "#run/runtime.js";

/** Persistence port for the console board (the G6 gene): configured cells survive a gateway
 *  restart. The consumer owns the disk I/O; observe stays port-only. */
export interface ObserveBoardPersistencePort {
  readonly initial?: Readonly<Record<string, Board>>; // by runId
  readonly onChange?: (runId: string, board: Board) => void;
}

export interface ObserveConsoleRuntimeHandle {
  readonly runtime: ObserveRuntime;
  readonly close: Effect.Effect<void>;
}

export const openObserveConsoleRuntime = (input: {
  readonly sessionInit: PackageRuntimeInit;
  readonly runId: string;
  readonly boardPersistence?: ObserveBoardPersistencePort;
}): Effect.Effect<ObserveConsoleRuntimeHandle, LiveStreakError> =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const runtime = yield* createObserveRuntime({ sessionInit: input.sessionInit }).pipe(
      Effect.provideService(Scope.Scope, scope)
    );
    // Restore must reach the WIRE, and the wire reads the control bus (readStoredRunBoard →
    // bus.readBoard), which closes over the board the bus was CONSTRUCTED with. So a saved board has
    // to seed the bus at mount time. The old post-hoc `store.replace({...run, board})` swapped the
    // store record but left the bus holding the pristine board it was built with, so nothing
    // downstream ever saw the restore — and commitBoard couldn't rescue it either, its revision guard
    // no-ops a board that isn't strictly ahead. Seeding at mount also dissolves the ordering problem.
    const saved = input.boardPersistence?.initial?.[input.runId];
    const restoredBoard = saved === undefined ? undefined : restoreBoard(saved);
    yield* ensureObserveShellRun(runtime, input, restoredBoard);

    const onChange = input.boardPersistence?.onChange;
    if (onChange !== undefined) {
      yield* runtime.subscribeBoard(input.runId, (board) => onChange(input.runId, board));
    }

    return {
      runtime,
      close: Scope.close(scope, Exit.void)
    };
  });

// A restarted gateway has no producer process: any live-ish run status on the saved board would
// LIE. Config/registration cells restore verbatim; an active system:run resets to re-preparable.
const ACTIVE_RUN_STATUSES: ReadonlySet<BoardRunStatus> = new Set([
  "preparing",
  "prepared",
  "starting",
  "running",
  "pausing",
  "paused",
  "resuming",
  "draining",
  "stopping"
]);

const restoreBoard = (board: Board): Board => {
  const initRunCellId = runCellIdOf(board) ?? "system:run";
  const runCell = board.cells[initRunCellId];
  if (runCell === undefined || !ACTIVE_RUN_STATUSES.has(runCell.status[0] as BoardRunStatus)) {
    return board;
  }
  return {
    ...board,
    revision: board.revision + 1,
    cells: {
      ...board.cells,
      [initRunCellId]: {
        ...runCell,
        status: ["created", "reset after gateway restart", Date.now()]
      }
    }
  };
};

/** Idempotent: mount the T0 shell run for `runId` if the store doesn't hold it yet. When resuming a
 *  gateway, pass the restored board so the bus is SEEDED with it (mountObserveT0Bus builds the bus from
 *  run.board, and surface mounting preserves restored cell state via mergeExistingBoardCell — keeping
 *  settings/readonly/status while refreshing only the function catalog). Absent it, the board is pristine. */
export const ensureObserveShellRun = (
  runtime: ObserveRuntime,
  input: { readonly sessionInit: PackageRuntimeInit; readonly runId: string },
  restoredBoard?: Board
): Effect.Effect<void, LiveStreakError> =>
  Effect.gen(function* () {
    const existing = yield* runtime.store.get(input.runId);
    if (existing !== undefined) {
      return;
    }
    const run = yield* makeObserveRun(shellRunConfig(input.runId));
    const seeded = restoredBoard === undefined ? run : { ...run, board: restoredBoard };
    const mounted = yield* mountObserveT0Bus(seeded, { sessionInit: input.sessionInit });
    yield* runtime.store.put(mounted);
  });
