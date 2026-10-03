// File-backed adapters for the packages' runtime persistence ports, injected at the console edge.
// Package side stays port-only (bookmaker IdempotencyPersistencePort, options PausedLanesPort); the
// disk I/O lives here. Load is async+up-front (ports want `initial` synchronously); onChange is a
// fire-and-forget atomic write whose failure is logged, never thrown into the runtime hot path.

import type { IdempotencyPersistedState, IdempotencyPersistencePort } from "@livestreak/bookmaker";
import type { Board, ObserveBoardPersistencePort } from "@livestreak/observe";
import type { OptionsPausedLane, PausedLanesPort } from "@livestreak/options";

import { createHash } from "node:crypto";
import { readStateFile, stateFilePath, writeStateFile } from "./file-store.js";

const scopedFile = (file: string, runId?: string): string => runId === undefined ? file : `${createHash("sha256").update(runId).digest("hex")}-${file}`;

const IDEMPOTENCY_FILE = "bookmaker-idempotency.json";
const PAUSED_LANES_FILE = "options-paused-lanes.json";
const OBSERVE_BOARDS_FILE = "observe-boards.json";

const pendingWrites = new Set<Promise<void>>();
export const flushRuntimePersistence = async (): Promise<void> => {
  while (pendingWrites.size) await Promise.all([...pendingWrites]);
};

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
    const pending = chain;
    pendingWrites.add(pending);
    void pending.finally(() => pendingWrites.delete(pending));
  };
};

export const loadIdempotencyPersistencePort = async (runId?: string): Promise<IdempotencyPersistencePort> => {
  const path = stateFilePath(scopedFile(IDEMPOTENCY_FILE, runId));
  const initial = await readStateFile<IdempotencyPersistedState>(path);
  let writes: Promise<void> = Promise.resolve();
  const write = (state: IdempotencyPersistedState): Promise<void> => {
    const next = writes.then(() => writeStateFile(path,state));
    // Keep queue usable while allowing prepare-before-send to fail closed.
    writes = next.catch(error => warnPersistFailure(IDEMPOTENCY_FILE,error));
    return next;
  };
  return {
    ...(initial === undefined ? {} : { initial }),
    onPrepareCreation: (state) => write(state),
    onChange: (state) => { void write(state).catch(error => warnPersistFailure(IDEMPOTENCY_FILE,error)); }
  };
};

export const loadPausedLanesPort = async (runId?: string): Promise<PausedLanesPort> => {
  const path = stateFilePath(scopedFile(PAUSED_LANES_FILE, runId));
  const initial = await readStateFile<readonly OptionsPausedLane[]>(path);
  const write = makeChainedWriter(path, PAUSED_LANES_FILE);
  return {
    ...(initial === undefined ? {} : { initial }),
    onChange: (lanes) => write(lanes)
  };
};

// A gateway mounts exactly ONE runId per session, so the persisted file should hold exactly that one
// board — not an archive. We prune to `activeRunId` on load: `initial` exposes only that runId (restore
// reads initial[runId] anyway), and if the stored file carried any other runId we rewrite it once now,
// so prior boots' orphan boards can't accumulate (one per boot, forever, otherwise).
export const loadObserveBoardsPort = async (
  activeRunId: string,
  scoped = false
): Promise<ObserveBoardPersistencePort> => {
  const path = stateFilePath(scopedFile(OBSERVE_BOARDS_FILE, scoped ? activeRunId : undefined));
  const stored = await readStateFile<Record<string, Board>>(path);
  const write = makeChainedWriter(path, OBSERVE_BOARDS_FILE);
  const savedBoard = stored?.[activeRunId];
  const initial = savedBoard === undefined ? undefined : { [activeRunId]: savedBoard };
  const boards: Record<string, Board> = { ...(initial ?? {}) };
  if (stored !== undefined && Object.keys(stored).some((id) => id !== activeRunId)) {
    write(boards);
  }
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
