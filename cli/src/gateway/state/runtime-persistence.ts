// File-backed adapters for the packages' runtime persistence ports, injected at the console edge.
// Package side stays port-only (bookmaker IdempotencyPersistencePort, options PausedLanesPort); the
// disk I/O lives here. Load is async+up-front (ports want `initial` synchronously); onChange is a
// fire-and-forget atomic write whose failure is logged, never thrown into the runtime hot path.

import type { IdempotencyPersistedState, IdempotencyPersistencePort } from "@livestreak/bookmaker";
import type { Board, ObserveBoardPersistencePort } from "@livestreak/observe";
import type { OptionsPausedLane, PausedLanesPort } from "@livestreak/options";

import { readStateFile, stateFilePath, writeStateFile } from "./file-store.js";

const IDEMPOTENCY_FILE = "bookmaker-idempotency.json";
const PAUSED_LANES_FILE = "options-paused-lanes.json";
const OBSERVE_BOARDS_FILE = "observe-boards.json";

const warnPersistFailure = (file: string, error: unknown): void => {
  console.error(
    `[gateway] failed to persist ${file}: ${error instanceof Error ? error.message : String(error)}`
  );
};

// Serialize onto a promise chain per file so overlapping onChange calls can't interleave writes.
const makeChainedWriter = (path: string, file: string): ((value: unknown) => void) => {
  let chain: Promise<void> = Promise.resolve();
  return (value) => {
    chain = chain
      .then(() => writeStateFile(path, value))
      .catch((error) => warnPersistFailure(file, error));
  };
};

export const loadIdempotencyPersistencePort = async (): Promise<IdempotencyPersistencePort> => {
  const path = stateFilePath(IDEMPOTENCY_FILE);
  const initial = await readStateFile<IdempotencyPersistedState>(path);
  const write = makeChainedWriter(path, IDEMPOTENCY_FILE);
  return {
    ...(initial === undefined ? {} : { initial }),
    onChange: (state) => write(state)
  };
};

export const loadPausedLanesPort = async (): Promise<PausedLanesPort> => {
  const path = stateFilePath(PAUSED_LANES_FILE);
  const initial = await readStateFile<readonly OptionsPausedLane[]>(path);
  const write = makeChainedWriter(path, PAUSED_LANES_FILE);
  return {
    ...(initial === undefined ? {} : { initial }),
    onChange: (lanes) => write(lanes)
  };
};

export const loadObserveBoardsPort = async (): Promise<ObserveBoardPersistencePort> => {
  const path = stateFilePath(OBSERVE_BOARDS_FILE);
  const initial = await readStateFile<Record<string, Board>>(path);
  const write = makeChainedWriter(path, OBSERVE_BOARDS_FILE);
  const boards: Record<string, Board> = { ...(initial ?? {}) };
  return {
    ...(initial === undefined ? {} : { initial }),
    onChange: (runId, board) => {
      // Boards may carry bigints in cell settings; JSON has none.
      boards[runId] = JSON.parse(
        JSON.stringify(board, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
      ) as Board;
      write(boards);
    }
  };
};
