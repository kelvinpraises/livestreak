// --- exports ---

// Steward's throw-based authorize wrappers around the CANONICAL depth-guarded capability kit in
// @livestreak/schema — the loose local matcher (no depth guard) is gone.

import { LiveStreakCapabilityError } from "@livestreak/core";
import { hasAnyScope } from "@livestreak/schema";

import type { BridgeCaller, CapabilityGrant, CapabilityScope } from "./types.js";

export type { CapabilityGrant, CapabilityScope } from "./types.js";
export { hasAnyScope, hasScope } from "@livestreak/schema";

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
