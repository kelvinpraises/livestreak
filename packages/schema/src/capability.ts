// Canonical capability/authorization kit for the Remote Bridge Console (Objective 4, P0).
//
// SECURITY-CRITICAL. This is the ONE depth-guarded scope matcher the whole monorepo relies on.
// Previously 4 copies / 2 implementations existed (observe = correct/depth-guarded; bookmaker,
// options, steward = loose/over-granting). This file is the single source of truth; every package
// CONSUMES it. See context/temp-convo/audit/scope-foundations.md (C1) for the full rationale.
//
// Pure synchronous TypeScript (no Effect runtime): the matcher is hot-path authz, called per relayed
// envelope. Each package keeps its own throw/Effect `authorize*` wrapper around these primitives.

// Capability scope strings: 2- or 3-segment (`a:b`, `a:b:c`) or the universal wildcard `*`.
export type CapabilityScope =
  | `${string}:${string}`
  | `${string}:${string}:${string}`
  | "*";

// A capability grant. For LOCAL trusted callers (CLI sudo) `sig`/`hostKeyId` are absent. For REMOTE
// grants the host signs `capabilityGrantSigningBytes(grant)` and the relay verifies it (P4).
export interface CapabilityGrant {
  readonly id: string;
  readonly sessionId: string;
  readonly holder: string;
  readonly scopes: readonly CapabilityScope[];
  readonly expiresAt?: number; // epoch ms; absent = non-expiring (remote grants SHOULD set this)
  readonly revoked: boolean;
  // --- remote-console addendum (host-signed, relay-verifiable grant; see scope-host B.4) ---
  readonly sig?: string; // host signature over capabilityGrantSigningBytes(grant); absent for local trusted callers
  readonly hostKeyId?: string; // which host key signed (key rotation / multi-host)
}

// The party invoking a bridge function. CLI local operator is `trusted:true` (sudo short-circuit);
// remote callers carry `grants` that the strict matcher checks.
export interface BridgeCaller {
  readonly id: string;
  readonly label?: string;
  readonly trusted?: boolean;
  readonly grants?: readonly CapabilityGrant[];
}

// Canonical bridge scope constants (were re-declared in every package's bridge/types.ts).
export const bridgeBoardReadScope = "bridge:board:read" as const;
export const bridgeControlsReadScope = "bridge:controls:read" as const;
export const bridgeActionScope = "bridge:action" as const;
export const bridgeBoardSubscribeScope = "bridge:board:subscribe" as const;

// Canonical action envelope (re-declared identically in options/bookmaker/steward bridge/types.ts).
// `action` is the bare fn name — the authz + spend key (`bridge:action:<action>`). `id` is the OPTIONAL
// cell-qualified descriptor id (e.g. "observe.capture.file.configure") used only for DISPATCH, so a
// package whose cells share a fn name (observe's per-cell configure/close) can be addressed precisely.
export interface CallActionEnvelope {
  readonly scope: typeof bridgeActionScope;
  readonly action: string;
  readonly id?: string;
  readonly args: unknown;
}

// Host module-gating token for the remote relay router (host consumes this; see scope-host B.5).
export const remoteModuleToken = "remote" as const;
export type RemoteModuleToken = typeof remoteModuleToken;

// THE matcher — observe's depth-guarded semantics, verbatim. `a:b:*` matches `a:b:c` (depth+1) ONLY,
// NOT `a:b:c:d` (the depth guard the 3 loose copies lacked) nor `a:b` (shorter).
export const scopeMatchesGrant = (
  grantScope: CapabilityScope,
  requiredScope: CapabilityScope
): boolean => {
  if (grantScope === "*") {
    return true;
  }

  if (grantScope === requiredScope) {
    return true;
  }

  if (!grantScope.endsWith(":*")) {
    return false;
  }

  const prefix = grantScope.slice(0, -2); // strip ":*"
  const prefixSegmentCount = prefix.split(":").length;
  const requiredSegmentCount = requiredScope.split(":").length;

  return requiredScope.startsWith(`${prefix}:`) && requiredSegmentCount === prefixSegmentCount + 1;
};

export const grantIsExpired = (expiresAt: number | undefined, now: number): boolean =>
  expiresAt !== undefined && expiresAt <= now;

export const hasScope = (
  grant: CapabilityGrant,
  requiredScope: CapabilityScope,
  now = Date.now()
): boolean =>
  !grant.revoked &&
  !grantIsExpired(grant.expiresAt, now) &&
  grant.scopes.some((grantScope) => scopeMatchesGrant(grantScope, requiredScope));

export const hasAnyScope = (
  grants: readonly CapabilityGrant[],
  requiredScope: CapabilityScope,
  now = Date.now()
): boolean => grants.some((grant) => hasScope(grant, requiredScope, now));

export interface CreateCapabilityGrantInput {
  readonly id: string;
  readonly holder: string;
  readonly scopes: readonly CapabilityScope[];
  readonly sessionId?: string;
  readonly expiresAt?: number;
  readonly revoked?: boolean;
  readonly sig?: string;
  readonly hostKeyId?: string;
}

export const createCapabilityGrant = (input: CreateCapabilityGrantInput): CapabilityGrant => ({
  id: input.id,
  sessionId: input.sessionId ?? input.id,
  holder: input.holder,
  scopes: input.scopes,
  ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  revoked: input.revoked ?? false,
  ...(input.sig === undefined ? {} : { sig: input.sig }),
  ...(input.hostKeyId === undefined ? {} : { hostKeyId: input.hostKeyId })
});

// Deterministic canonical signing payload so host(sign), host(verify), and the relay agree
// byte-for-byte. Excludes `sig` itself (the signature can't cover itself). Field order is FIXED here,
// independent of object construction order, so two equal grants always serialize identically.
export const capabilityGrantSigningBytes = (
  grant: Omit<CapabilityGrant, "sig">
): Uint8Array => {
  const canonical = {
    id: grant.id,
    sessionId: grant.sessionId,
    holder: grant.holder,
    scopes: [...grant.scopes],
    expiresAt: grant.expiresAt ?? null,
    revoked: grant.revoked,
    hostKeyId: grant.hostKeyId ?? null
  };
  return new TextEncoder().encode(JSON.stringify(canonical));
};
