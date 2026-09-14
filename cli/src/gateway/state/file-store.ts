// File-backed JSON state for the gateway's in-memory runtime stores (bookmaker idempotency,
// options paused lanes). Lives OUTSIDE the packages — they stay port-only; this is the CLI edge's
// injected adapter. Mirrors keystore.ts: ~/.livestreak state dir, LIVESTREAK_STATE_DIR override for
// tests, atomic tmp+rename writes.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const defaultStateDir = (): string =>
  process.env["LIVESTREAK_STATE_DIR"] ?? join(homedir(), ".livestreak", "state");

export const stateFilePath = (name: string): string => join(defaultStateDir(), name);

/** Read + parse a JSON state file; returns undefined if it does not exist yet. Corrupt files throw. */
export const readStateFile = async <T>(path: string): Promise<T | undefined> => {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  return JSON.parse(raw) as T;
};

/** Serialize + persist atomically (tmp + rename) so a crash mid-write never leaves a torn file. */
export const writeStateFile = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, path);
};
