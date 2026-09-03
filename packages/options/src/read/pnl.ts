// --- exports ---

import type { UserAddress } from "../model/ids.js";
import type { OptionsSessionPnlView } from "../model/pnl.js";
import { projectSessionPnl } from "../model/pnl.js";
import { gatherUserVaultClaims } from "./aggregation.js";
import type { OptionsReadTransport } from "./transport.js";

export const readSessionPnl = async (
  transport: OptionsReadTransport,
  user: UserAddress,
  investedUSDC?: bigint
): Promise<OptionsSessionPnlView> => {
  const [claims, tokenIds] = await Promise.all([
    gatherUserVaultClaims(transport, user),
    transport.listOwnerTokens(user)
  ]);

  const nftBalances = await Promise.all(
    tokenIds.map(async (tokenId) => ({
      tokenId,
      remainingUSDC: await transport.readNftBalance(tokenId)
    }))
  );

  return projectSessionPnl({
    claims,
    nftBalances,
    ...(investedUSDC === undefined ? {} : { investedUSDC })
  });
};
