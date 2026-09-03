// --- exports ---

import type { UserAddress } from "../model/ids.js";
import type { OptionsClaimsView } from "../model/claims.js";
import { projectClaimsView } from "../model/claims.js";
import { gatherUserVaultClaims } from "./aggregation.js";
import type { OptionsReadTransport } from "./transport.js";

export const readClaimsView = async (
  transport: OptionsReadTransport,
  user: UserAddress
): Promise<OptionsClaimsView> => {
  const rows = await gatherUserVaultClaims(transport, user);
  return projectClaimsView(user, rows);
};
