// Observe's Effect-based authorize wrappers around the CANONICAL capability kit in
// @livestreak/schema (the one depth-guarded matcher). Types/primitives are re-exports — no local copy.

import { LiveStreakCapabilityError } from "@livestreak/core";
import { Effect } from "effect";
import {
  hasAnyScope,
  hasScope,
  type CapabilityGrant,
  type CapabilityScope
} from "@livestreak/schema";

export { createCapabilityGrant, hasAnyScope, hasScope } from "@livestreak/schema";
export type {
  CapabilityGrant,
  CapabilityScope,
  CreateCapabilityGrantInput
} from "@livestreak/schema";

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
