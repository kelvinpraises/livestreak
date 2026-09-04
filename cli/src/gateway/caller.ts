import type { BridgeCaller } from "@livestreak/observe";

/** Local sudo operator for package bridges (trusted admission). */
export const localOperatorCaller = (): BridgeCaller => ({
  id: "local-operator",
  label: "CLI local sudo operator",
  trusted: true
  // remote admission: mint/verify CapabilityGrant — see TODO "Deferred"
  // grants?: readonly CapabilityGrant[];
});
