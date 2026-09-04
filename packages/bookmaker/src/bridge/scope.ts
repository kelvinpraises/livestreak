// --- exports ---

import { LiveStreakCapabilityError } from "@livestreak/core";

import type { BridgeCaller, CapabilityGrant, CapabilityScope } from "./types.js";

export type { CapabilityGrant, CapabilityScope } from "./types.js";

export const hasScope = (
  grant: CapabilityGrant,
  requiredScope: CapabilityScope,
  nowMs: number
): boolean => {
  if (grant.revoked || grantIsExpired(grant.expiresAt, nowMs)) {
    return false;
  }

  return grant.scopes.some((grantScope) => scopeMatchesGrant(grantScope, requiredScope));
};

export const hasAnyScope = (
  grants: readonly CapabilityGrant[],
  requiredScope: CapabilityScope,
  nowMs: number
): boolean => grants.some((grant) => hasScope(grant, requiredScope, nowMs));

export const requireAnyScope = (
  grants: readonly CapabilityGrant[],
  requiredScope: CapabilityScope,
  nowMs: number
): void => {
  if (hasAnyScope(grants, requiredScope, nowMs)) {
    return;
  }

  throw new LiveStreakCapabilityError({
    message: `No capability grant authorizes ${requiredScope}`,
    requiredScope
  });
};

export const authorizeBridgeCaller = (
  caller: BridgeCaller,
  requiredScope: CapabilityScope,
  nowMs: number
): void => {
  validateBridgeCaller(caller);

  if (caller.trusted === true) {
    return;
  }

  requireAnyScope(caller.grants ?? [], requiredScope, nowMs);
};

// --- helpers ---

const validateBridgeCaller = (caller: BridgeCaller): void => {
  if (caller.id.trim().length === 0) {
    throw new LiveStreakCapabilityError({
      message: "Bridge caller id is required",
      requiredScope: "*"
    });
  }
};

const grantIsExpired = (expiresAt: number | undefined, now: number): boolean =>
  expiresAt !== undefined && expiresAt <= now;

const scopeMatchesGrant = (
  grantScope: CapabilityScope,
  requiredScope: CapabilityScope
): boolean => {
  if (grantScope === "*") {
    return true;
  }

  if (grantScope === requiredScope) {
    return true;
  }

  if (grantScope.endsWith(":*")) {
    const prefix = grantScope.slice(0, -1);
    return requiredScope.startsWith(prefix);
  }

  return false;
};
