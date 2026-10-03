// Persistent, NON-SECRET session index so `remote list` / `remote revoke` work across CLI invocations
// (the in-memory SessionRegistry is authoritative only inside a running daemon). Holds ONLY metadata —
// never seed/grant signatures. Stored next to the keystore (~/.livestreak/sessions.json), 0600.

import { mkdir, readFile, writeFile, rename, rm, open } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CapabilityScope } from "@livestreak/schema";

export interface StoredSession {
  readonly sessionId: string;
  readonly scopes: readonly CapabilityScope[];
  readonly createdAtMs: number;
  readonly expiresAt: number;
  readonly spendCapUSDC?: string;
  spentUSDC: string;
  revoked: boolean;
  remoteUrl?: string;
  consoleOrigin?: string;
  holder?: string;
  runId?: string;
  passwordVerifier?: string;
  contextDigest?: string;
  configurations?: Record<string, { marketId?: string; vaultId?: string }>;
}

export const defaultSessionStorePath = (): string =>
  process.env["LIVESTREAK_SESSION_STORE"] ?? join(homedir(), ".livestreak", "sessions.json");

export const loadSessions = async (path: string): Promise<StoredSession[]> => {
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || !value.every(validSession)) throw new Error("invalid session metadata");
    return value as StoredSession[];
  } catch {
    // Preserve corrupt state for diagnosis; never reuse privileges from partial metadata.
    const backup = `${path}.corrupt-${randomUUID()}`;
    await rename(path, backup);
    console.error("[gateway] Session metadata is corrupt; preserved a backup. Start a fresh session.");
    return [];
  }
};

const validSession = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const s = value as StoredSession;
  return typeof s.sessionId === "string" && /^[a-zA-Z0-9_-]+$/.test(s.sessionId) &&
    Array.isArray(s.scopes) && s.scopes.every(scope => typeof scope === "string") &&
    Number.isFinite(s.createdAtMs) && Number.isFinite(s.expiresAt) && s.expiresAt > s.createdAtMs &&
    typeof s.revoked === "boolean" && typeof s.spentUSDC === "string" && /^\d+$/.test(s.spentUSDC) &&
    (s.spendCapUSDC === undefined || (typeof s.spendCapUSDC === "string" && /^\d+$/.test(s.spendCapUSDC)));
};

export const saveSessions = async (path: string, sessions: readonly StoredSession[]): Promise<void> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${randomUUID()}`;
  try {
    const file = await open(tmp, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(sessions, null, 2)); await file.sync(); }
    finally { await file.close(); }
    await rename(tmp, path);
  } finally { await rm(tmp, { force: true }); }
};

// Serialize read/modify/write operations in this gateway. Revoke from another CLI is
// observed before replacement; its terminal flag cannot be cleared by a board/spend update.
const writes = new Map<string, Promise<void>>();
const mutateSessions = async (path: string, change: (sessions: StoredSession[]) => StoredSession[]): Promise<void> => {
  const next = (writes.get(path) ?? Promise.resolve()).catch(() => {}).then(async () => {
    let release: (() => Promise<void>) | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { release = await acquireSessionLock(path, "store"); break; }
      catch (error) {
        if (!(error instanceof Error) || !error.message.includes("already running")) throw error;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    if (!release) throw new Error("session store busy; refusing an unsafe write");
    try { await saveSessions(path, change(await loadSessions(path))); }
    finally { await release(); }
  });
  writes.set(path, next);
  await next;
};
export const upsertSession = async (path: string, session: StoredSession): Promise<void> => {
  await mutateSessions(path, sessions => {
    const old = sessions.find(s => s.sessionId === session.sessionId);
    return [...sessions.filter(s => s.sessionId !== session.sessionId),
      { ...session, revoked: session.revoked || old?.revoked === true }];
  });
};

/** One local owner per session. A killed process leaves a reclaimable PID lock. */
export const acquireSessionLock = async (path: string, sessionId: string): Promise<() => Promise<void>> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = `${path}.${sessionId}.lock`;
  const token = `${process.pid}:${randomUUID()}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await writeFile(lock, token, { flag: "wx", mode: 0o600 });
      return async () => { if (await readFile(lock, "utf8").catch(() => "") === token) await rm(lock, { force: true }); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = await readFile(lock, "utf8");
      const pid = Number(owner.split(":")[0]);
      if (!Number.isInteger(pid) || pid <= 0) throw new Error("invalid session lock; inspect it before restarting");
      try { process.kill(pid, 0); throw new Error("session gateway is already running"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      await rm(lock, { force: true });
    }
  }
  throw new Error("unable to acquire session lock");
};

export const markRevoked = async (path: string, sessionId: string): Promise<boolean> => {
  let found = false;
  await mutateSessions(path, sessions => {
    const target = sessions.find(s => s.sessionId === sessionId);
    if (target) { target.revoked = true; found = true; }
    return sessions;
  });
  return found;
};

// Active = not revoked and not expired (at `now`).
export const activeSessions = (sessions: readonly StoredSession[], now = Date.now()): StoredSession[] =>
  sessions.filter((s) => !s.revoked && s.expiresAt > now);
