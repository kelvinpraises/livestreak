import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readStateFile, stateFilePath, writeStateFile } from "../src/gateway/state/file-store.js";
import {
  loadIdempotencyPersistencePort,
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
