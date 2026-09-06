// Gateway session registry + remote authorization (Objective 4, P3/P6).
//
// A remote session is a host-pairable, scoped, expiring grant the operator mints with `remote open`.
// EVERY relayed call is treated as hostile: the gateway authorizes it against the session's grant
// using the CANONICAL depth-guarded scope matcher from @livestreak/schema (the options bridge only
// checks the coarse `bridge:action` scope with a loose matcher, so the gateway is the real granular
// gate — defense in depth) BEFORE the unlocked seed touches anything.

import { randomBytes, randomUUID } from "node:crypto";
import {
  bridgeActionScope,
  bridgeBoardReadScope,
  createCapabilityGrant,
  grantIsExpired,
  hasAnyScope,
  scopeMatchesGrant,
  type BridgeCaller,
  type CapabilityGrant,
  type CapabilityScope,
  type CallActionEnvelope
} from "@livestreak/schema";

export interface SessionRecord {
  readonly sessionId: string; // pairing code shared with the remote user
  readonly holder: string;
  readonly scopes: readonly CapabilityScope[];
  readonly expiresAt: number; // epoch ms — remote grants ALWAYS expire
  readonly createdAtMs: number;
  readonly spendCapUSDC?: bigint; // atomic 6dp; absent = no cap
  spentUSDC: bigint;
  revoked: boolean;
  remoteUrl?: string; // filled from the host ACK
}

export interface MintSessionInput {
  readonly scopes: readonly CapabilityScope[];
  readonly ttlMs: number;
  readonly holder?: string;
  readonly spendCapUSDC?: bigint;
  readonly nowMs?: number;
}

export const PAIRING_CODE_BYTES = 5; // 10 hex chars

export const newPairingCode = (): string => randomBytes(PAIRING_CODE_BYTES).toString("hex");

// Parse a human TTL ("30m", "1h", "90s", "500ms") or a bare millisecond number.
export const parseTtlMs = (value: string): number => {
  const trimmed = value.trim().toLowerCase();
  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(trimmed);
  if (match === null) {
    throw new Error(`invalid --ttl "${value}" (use e.g. 30m, 1h, 90s, or a ms number)`);
  }
  const n = Number(match[1]);
  switch (match[2]) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case undefined:
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    case "d":
      return n * 86_400_000;
    default:
      throw new Error(`invalid --ttl unit in "${value}"`);
  }
};

// Parse a comma/space-separated scope list. Rejects empty and the universal wildcard "*": the
// operator must only expose scopes that are actually enforced — no coarse "any action" grant
// (Kudaben permission-granularity decision).
export const parseScopes = (value: string): readonly CapabilityScope[] => {
  const scopes = value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (scopes.length === 0) {
    throw new Error("--scopes must list at least one scope");
  }
  for (const scope of scopes) {
    if (scope === "*") {
      throw new Error('refusing to grant "*" (sudo) to a remote session — list explicit scopes');
    }
    if (scope === bridgeActionScope) {
      throw new Error(
        `refusing to grant the coarse "${bridgeActionScope}" — use granular bridge:action:<name>`
      );
    }
    if (!/^[a-z]+:[a-z]+(:[a-z*]+)?$/i.test(scope)) {
      throw new Error(`invalid scope "${scope}" (expected a:b or a:b:c)`);
    }
  }
  return scopes as readonly CapabilityScope[];
};

// The granular scope an action requires. e.g. action "fund" → "bridge:action:fund". A grant of
// "bridge:action:fund" or "bridge:action:*" authorizes it; the bare "bridge:action" does NOT
// (depth-guarded canonical matcher).
export const requiredScopeForAction = (action: string): CapabilityScope =>
  `${bridgeActionScope}:${action}` as CapabilityScope;

// USDC-spending actions and the args field carrying the atomic amount.
const SPEND_FIELD: Record<string, string> = {
  fund: "deposit",
  createVault: "creatorStake",
  setLanes: "addDeposit"
};

export const spendAmountOfEnvelope = (envelope: CallActionEnvelope): bigint => {
  const field = SPEND_FIELD[envelope.action];
  if (field === undefined) {
    return 0n;
  }
  const args = envelope.args as Record<string, unknown> | null;
  const raw = args?.[field];
  if (raw === undefined || raw === null) {
    return 0n;
  }
  try {
    return BigInt(raw as string | number | bigint);
  } catch {
    return 0n;
  }
};

export interface AuthDecision {
  readonly ok: boolean;
  readonly error?: string;
}

// The in-memory registry: one daemon process, one unlocked seed, many sessions.
export class SessionRegistry {
  private readonly sessions = new Map<string, SessionRecord>();

  mint(input: MintSessionInput): SessionRecord {
    const now = input.nowMs ?? Date.now();
    const record: SessionRecord = {
      sessionId: newPairingCode(),
      holder: input.holder ?? "remote",
      scopes: input.scopes,
      expiresAt: now + input.ttlMs,
      createdAtMs: now,
      ...(input.spendCapUSDC === undefined ? {} : { spendCapUSDC: input.spendCapUSDC }),
      spentUSDC: 0n,
      revoked: false
    };
    this.sessions.set(record.sessionId, record);
    return record;
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  list(): readonly SessionRecord[] {
    return [...this.sessions.values()];
  }

  revoke(sessionId: string): boolean {
    const record = this.sessions.get(sessionId);
    if (record === undefined) {
      return false;
    }
    record.revoked = true;
    return true;
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  // Build the NON-trusted caller the package bridge sees. Carries the operator's granular scopes plus
  // the coarse bridge:action / bridge:board:read the bridge itself checks. trusted:false ensures the
  // bridge never short-circuits the sudo path for a remote call.
  callerFor(record: SessionRecord): BridgeCaller {
    const grant: CapabilityGrant = createCapabilityGrant({
      id: `remote-${record.sessionId}`,
      sessionId: record.sessionId,
      holder: record.holder,
      scopes: [...record.scopes, bridgeActionScope, bridgeBoardReadScope],
      expiresAt: record.expiresAt,
      revoked: record.revoked
    });
    return {
      id: `remote:${record.sessionId}`,
      label: "remote bridge console session",
      trusted: false,
      grants: [grant]
    };
  }

  // Authorize a relayed action call against the session grant: existence, not revoked, not expired,
  // granular scope present, and spend-cap not exceeded.
  authorize(sessionId: string, envelope: CallActionEnvelope, nowMs = Date.now()): AuthDecision {
    const record = this.sessions.get(sessionId);
    if (record === undefined) {
      return { ok: false, error: "unknown session" };
    }
    if (record.revoked) {
      return { ok: false, error: "session revoked" };
    }
    if (grantIsExpired(record.expiresAt, nowMs)) {
      return { ok: false, error: "session expired" };
    }

    const required = requiredScopeForAction(envelope.action);
    const authorized = record.scopes.some((granted) => scopeMatchesGrant(granted, required));
    if (!authorized) {
      return { ok: false, error: `scope ${required} not granted` };
    }

    const amount = spendAmountOfEnvelope(envelope);
    if (amount > 0n && record.spendCapUSDC !== undefined) {
      if (record.spentUSDC + amount > record.spendCapUSDC) {
        return {
          ok: false,
          error: `spend cap exceeded: ${(record.spentUSDC + amount).toString()} > ${record.spendCapUSDC.toString()}`
        };
      }
    }
    return { ok: true };
  }

  // Commit a successful spend against the per-session lifetime cap accumulator.
  commitSpend(sessionId: string, envelope: CallActionEnvelope): void {
    const record = this.sessions.get(sessionId);
    if (record === undefined || record.spendCapUSDC === undefined) {
      return;
    }
    record.spentUSDC += spendAmountOfEnvelope(envelope);
  }
}

// Re-export the canonical helper so the relay can also do a defensive grant check if it holds a grant
// rather than a session (kept for symmetry with the host's verifier).
export { hasAnyScope };
