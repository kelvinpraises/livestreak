// Filter a package's FunctionDescriptor[] down to the functions a session's scopes authorize.
//
// Console scope-unification (wave 5): package descriptor projections now emit the uniform granular
// console scope `bridge:action:<name>` DIRECTLY (projectOptions/observe/bookmakerDescriptors), so the
// gateway no longer NORMALIZES package-internal scopes at the boundary — it only FILTERS, using the
// canonical depth-guarded matcher, the same scope string the host relay authorizes against (defense in
// depth: the host re-filters server-side too).

import { scopeMatchesGrant, type CapabilityScope, type FunctionDescriptor } from "@livestreak/schema";

export const projectConsoleFunctions = (
  raw: readonly FunctionDescriptor[],
  sessionScopes: readonly CapabilityScope[]
): readonly FunctionDescriptor[] =>
  raw.filter((fn) => sessionScopes.some((granted) => scopeMatchesGrant(granted, fn.scope)));
