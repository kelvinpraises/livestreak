import { LiveStreakCapabilityError } from "@livestreak/core";
import { Effect } from "effect";

export type CapabilityScope =
  | `${string}:${string}`
  | `${string}:${string}:${string}`
  | "*";

export interface CapabilityGrant {
  readonly id: string;
  readonly sessionId: string;
  readonly holder: string;
  readonly scopes: readonly CapabilityScope[];
  readonly expiresAt?: number;
  readonly revoked: boolean;
}

export interface CreateCapabilityGrantInput {
  readonly id: string;
  readonly holder: string;
  readonly scopes: readonly CapabilityScope[];
  readonly sessionId?: string;
  readonly expiresAt?: number;
  readonly revoked?: boolean;
}

export const createCapabilityGrant = (input: CreateCapabilityGrantInput): CapabilityGrant => ({
  id: input.id,
  sessionId: input.sessionId ?? input.id,
  holder: input.holder,
  scopes: input.scopes,
  ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  revoked: input.revoked ?? false
});

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

export const requireScope = (
  grant: CapabilityGrant,
  requiredScope: CapabilityScope
): Effect.Effect<void, LiveStreakCapabilityError> => {
  if (hasScope(grant, requiredScope)) {
    return Effect.void;
  }

  return Effect.fail(
    new LiveStreakCapabilityError({
      message: `Capability ${grant.id} cannot use ${requiredScope}`,
      requiredScope
    })
  );
};

export const requireAnyScope = (
  grants: readonly CapabilityGrant[],
  requiredScope: CapabilityScope,
  now = Date.now()
): Effect.Effect<void, LiveStreakCapabilityError> => {
  if (hasAnyScope(grants, requiredScope, now)) {
    return Effect.void;
  }

  return Effect.fail(
    new LiveStreakCapabilityError({
      message: `No capability grant authorizes ${requiredScope}`,
      requiredScope
    })
  );
};

// --- helpers ---

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

  if (!grantScope.endsWith(":*")) {
    return false;
  }

  const prefix = grantScope.slice(0, -2);
  const prefixSegmentCount = prefix.split(":").length;
  const requiredSegmentCount = requiredScope.split(":").length;

  return requiredScope.startsWith(`${prefix}:`) && requiredSegmentCount === prefixSegmentCount + 1;
};
