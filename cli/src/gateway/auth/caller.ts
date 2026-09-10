/** Local sudo operator for package bridges (trusted admission). */
export const localOperatorCaller = () => ({
  id: "local-operator",
  label: "CLI local sudo operator",
  trusted: true as const
  // remote admission: mint/verify CapabilityGrant — see TODO "Deferred"
  // grants?: readonly CapabilityGrant[];
});
