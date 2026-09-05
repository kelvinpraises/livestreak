// --- exports ---

import { LiveStreakCapabilityError } from "@livestreak/core";

import type { BridgeCaller, CapabilityGrant, CapabilityScope } from "./types.js";

export type { CapabilityGrant, CapabilityScope } from "./types.js";

export const hasScope = (
  grant: CapabilityGrant,
  requiredScope: CapabilityScope,
  now = Date.now()
): boolean => {
  if (grant.revoked || grantIsExpired(grant.expiresAt, now)) {
    return false;
  }

  return grant.scopes.some((grantScope) => scopeMatchesGrant(grantScope, requiredScope));
};

export const hasAnyScope = (
  grants: readonly CapabilityGrant[],
  requiredScope: CapabilityScope,
  now = Date.now()
): boolean => grants.some((grant) => hasScope(grant, requiredScope, now));

export const requireAnyScope = (
  grants: readonly CapabilityGrant[],
  requiredScope: CapabilityScope,
  now = Date.now()
): void => {
  if (hasAnyScope(grants, requiredScope, now)) {
    return;
  }

  throw new LiveStreakCapabilityError({
    message: `No capability grant authorizes ${requiredScope}`,
    requiredScope
  });
};

export const authorizeBridgeCaller = (caller: BridgeCaller, requiredScope: CapabilityScope): void => {
  validateBridgeCaller(caller);

  if (caller.trusted === true) {
    return;
  }

  requireAnyScope(caller.grants ?? [], requiredScope);
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
