import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readStateFile, stateFilePath, writeStateFile } from "../src/gateway/state/file-store.js";
import {
  loadIdempotencyPersistencePort,
  loadObserveBoardsPort,
  loadPausedLanesPort
} from "../src/gateway/state/runtime-persistence.js";

let dir: string;
const prevEnv = process.env["LIVESTREAK_STATE_DIR"];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "livestreak-state-"));
  process.env["LIVESTREAK_STATE_DIR"] = dir;
});

afterEach(async () => {
  if (prevEnv === undefined) delete process.env["LIVESTREAK_STATE_DIR"];
  else process.env["LIVESTREAK_STATE_DIR"] = prevEnv;
  await rm(dir, { recursive: true, force: true });
});

// Poll until an onChange fire-and-forget write lands (the port swallows write errors, chains them).
const readEventually = async <T>(path: string): Promise<T> => {
  for (let i = 0; i < 50; i += 1) {
    const value = await readStateFile<T>(path);
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`state file never appeared: ${path}`);
};

// Poll until the file satisfies a predicate — the file may already exist with STALE content (a prune
// rewrites it in place), so "exists" is not enough to observe the new state.
const readUntil = async <T>(path: string, pred: (value: T) => boolean): Promise<T> => {
  for (let i = 0; i < 50; i += 1) {
    const value = await readStateFile<T>(path);
    if (value !== undefined && pred(value)) return value;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`state file never satisfied predicate: ${path}`);
};

describe("gateway/state file-store", () => {
  it("round-trips a JSON value and returns undefined when absent", async () => {
    const path = stateFilePath("round-trip.json");
    expect(await readStateFile(path)).toBeUndefined();
    await writeStateFile(path, { a: 1, b: ["x"] });
    expect(await readStateFile(path)).toEqual({ a: 1, b: ["x"] });
  });
});

describe("idempotency persistence port (file-backed)", () => {
  it("has no initial when the file is absent, then persists onChange", async () => {
    const port = await loadIdempotencyPersistencePort();
    expect(port.initial).toBeUndefined();

    const state = { settled: { k: { txId: "0xtx", vaultId: "0xv" } }, pending: {} };
    port.onChange?.(state as never);

    const path = stateFilePath("bookmaker-idempotency.json");
    expect(await readEventually(path)).toEqual(state);
  });

  it("rehydrates initial from a pre-existing file", async () => {
    const seeded = { settled: { done: { txId: "0xt", vaultId: "0xvv" } }, pending: { live: "0xh" } };
    await writeStateFile(stateFilePath("bookmaker-idempotency.json"), seeded);

    const port = await loadIdempotencyPersistencePort();
    expect(port.initial).toEqual(seeded);
  });
});

describe("paused-lanes persistence port (file-backed)", () => {
  it("persists onChange and rehydrates initial", async () => {
    const first = await loadPausedLanesPort();
    expect(first.initial).toBeUndefined();

    const lanes = [{ tokenId: "1", vaultId: "0xv", side: "yes", rate: "10" }];
    first.onChange?.(lanes as never);

    const path = stateFilePath("options-paused-lanes.json");
    expect(await readEventually(path)).toEqual(lanes);

    const second = await loadPausedLanesPort();
    expect(second.initial).toEqual(lanes);
  });
});

describe("observe boards persistence port (file-backed)", () => {
  const boardsPath = (): string => stateFilePath("observe-boards.json");
  const board = (marker: string): unknown => ({
    revision: 3,
    cells: {
      "system:config": {
        label: "Session",
        catalog: "system:config",
        status: ["idle", null, 0],
        settings: { marker },
        readonly: {},
        functions: []
      }
    }
  });

  it("exposes initial only for the active runId and restores it", async () => {
    await writeStateFile(boardsPath(), { "remote-A": board("A"), "remote-B": board("B") });
    const port = await loadObserveBoardsPort("remote-A");
    expect(port.initial).toEqual({ "remote-A": board("A") });
  });

  it("prunes prior boots' orphan boards on load — the file never becomes an archive", async () => {
    // The §1.1 receipt: unpruned, observe-boards.json grew one orphan board per boot, forever.
    await writeStateFile(boardsPath(), {
      "remote-old-1": board("1"),
      "remote-old-2": board("2"),
      "remote-current": board("cur")
    });
    await loadObserveBoardsPort("remote-current");
    const onDisk = await readUntil<Record<string, unknown>>(
      boardsPath(),
      (value) => Object.keys(value).length === 1
    );
    expect(Object.keys(onDisk)).toEqual(["remote-current"]);
  });

  it("has no initial when the active runId is absent, and still drops the stale orphan", async () => {
    await writeStateFile(boardsPath(), { "remote-stale": board("s") });
    const port = await loadObserveBoardsPort("remote-fresh");
    expect(port.initial).toBeUndefined();
    const onDisk = await readUntil<Record<string, unknown>>(
      boardsPath(),
      (value) => Object.keys(value).length === 0
    );
    expect(onDisk).toEqual({});
  });

  it("persists onChange and stringifies bigint cell settings (JSON has no bigint)", async () => {
    const port = await loadObserveBoardsPort("remote-C");
    expect(port.initial).toBeUndefined();
    const withBigint = { revision: 1, cells: { x: { settings: { atomicUsdc: 42n } } } };
    port.onChange?.("remote-C", withBigint as never);
    const onDisk = await readEventually<Record<string, { cells: { x: { settings: { atomicUsdc: unknown } } } }>>(
      boardsPath()
    );
    expect(onDisk["remote-C"]?.cells.x.settings.atomicUsdc).toBe("42");
  });
});
