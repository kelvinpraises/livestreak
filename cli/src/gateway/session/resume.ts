import { createHash } from "node:crypto";
import type { StoredSession } from "./store.js";
import type { SessionRecord } from "./registry.js";

export const sessionContextDigest = (settings: unknown, operatorAddress: string): string =>
  createHash("sha256").update(JSON.stringify({ settings, operatorAddress })).digest("hex");

export const restoreSessionRecord = (stored: StoredSession | undefined, contextDigest: string): SessionRecord => {
  if (!stored) throw new Error("Resume metadata missing or corrupt; use remote open to create a new session explicitly.");
  if (stored.revoked) throw new Error("Session revoked; it cannot be resumed.");
  if (stored.expiresAt <= Date.now()) throw new Error("Session expired; it cannot be resumed.");
  if (stored.contextDigest !== contextDigest || stored.runId !== `remote-${stored.sessionId}` ||
      !stored.passwordVerifier || !stored.holder) {
    throw new Error("Session context or resume metadata does not match. Use the original wallet/settings or create a new session.");
  }
  return {
    sessionId: stored.sessionId, holder: stored.holder, scopes: stored.scopes,
    createdAtMs: stored.createdAtMs, expiresAt: stored.expiresAt,
    ...(stored.spendCapUSDC === undefined ? {} : { spendCapUSDC: BigInt(stored.spendCapUSDC) }),
    spentUSDC: BigInt(stored.spentUSDC), revoked: false,
    ...(stored.remoteUrl === undefined ? {} : { remoteUrl: stored.remoteUrl }),
  };
};
