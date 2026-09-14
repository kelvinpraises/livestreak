// --- exports ---

// Bookmaker's throw-based authorize wrappers (explicit nowMs, matching this package's call sites)
// around the CANONICAL depth-guarded capability kit in @livestreak/schema — the loose local matcher
// (no depth guard) is gone. Schema's hasScope/hasAnyScope take now as an optional third arg, so the
// explicit-nowMs style threads straight through.

import { LiveStreakCapabilityError } from "@livestreak/core";
import { hasAnyScope } from "@livestreak/schema";

import type { BridgeCaller, CapabilityGrant, CapabilityScope } from "./types.js";

export type { CapabilityGrant, CapabilityScope } from "./types.js";
export { hasAnyScope, hasScope } from "@livestreak/schema";

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
