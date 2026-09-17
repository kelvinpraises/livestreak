// Canonical throw-based authorize wrappers around @livestreak/schema's capability kit.
// One implementation for every package bridge (options/bookmaker/steward re-export these;
// observe keeps its Effect variant over the same schema primitives).

import {
  hasAnyScope,
  type BridgeCaller,
  type CapabilityGrant,
  type CapabilityScope
} from "@livestreak/schema";

import { LiveStreakCapabilityError } from "./errors.js";

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

export const authorizeBridgeCaller = (
  caller: BridgeCaller,
  requiredScope: CapabilityScope,
  now = Date.now()
): void => {
  if (caller.id.trim().length === 0) {
    throw new LiveStreakCapabilityError({
      message: "Bridge caller id is required",
      requiredScope: "*"
    });
  }

  if (caller.trusted === true) {
    return;
  }

  requireAnyScope(caller.grants ?? [], requiredScope, now);
};
