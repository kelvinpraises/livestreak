// Persistent, NON-SECRET session index so `remote list` / `remote revoke` work across CLI invocations
// (the in-memory SessionRegistry is authoritative only inside a running daemon). Holds ONLY metadata —
// never seed/grant signatures. Stored next to the keystore (~/.livestreak/sessions.json), 0600.

import { mkdir, readFile, writeFile } from "node:fs/promises";
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
}

export const defaultSessionStorePath = (): string =>
  process.env["LIVESTREAK_SESSION_STORE"] ?? join(homedir(), ".livestreak", "sessions.json");

export const loadSessions = async (path: string): Promise<StoredSession[]> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as StoredSession[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

export const saveSessions = async (path: string, sessions: readonly StoredSession[]): Promise<void> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(sessions, null, 2), { mode: 0o600 });
};

export const upsertSession = async (path: string, session: StoredSession): Promise<void> => {
  const sessions = await loadSessions(path);
  const next = sessions.filter((s) => s.sessionId !== session.sessionId);
  next.push(session);
  await saveSessions(path, next);
};

export const markRevoked = async (path: string, sessionId: string): Promise<boolean> => {
  const sessions = await loadSessions(path);
  const target = sessions.find((s) => s.sessionId === sessionId);
  if (target === undefined) {
    return false;
  }
  target.revoked = true;
  await saveSessions(path, sessions);
  return true;
};

// Active = not revoked and not expired (at `now`).
export const activeSessions = (sessions: readonly StoredSession[], now = Date.now()): StoredSession[] =>
  sessions.filter((s) => !s.revoked && s.expiresAt > now);
