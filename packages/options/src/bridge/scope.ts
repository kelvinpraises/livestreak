// Options re-exports the canonical throw-based authorize kit (single implementation in core).

export { authorizeBridgeCaller, requireAnyScope } from "@livestreak/core";
export { hasAnyScope, hasScope } from "@livestreak/schema";
export type { CapabilityGrant, CapabilityScope } from "./types.js";
