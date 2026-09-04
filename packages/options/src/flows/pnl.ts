// --- exports ---

import type { UserAddress } from "../model/ids.js";
import type { OptionsSessionPnlView } from "../model/math/pnl.js";
import { projectSessionPnl } from "../model/math/pnl.js";
import type { OptionsReader } from "../chains/types.js";
import { gatherUserVaultClaims } from "./claims.js";

export const readSessionPnl = async (
  reader: OptionsReader,
  user: UserAddress,
  investedUSDC?: bigint
): Promise<OptionsSessionPnlView> => {
  const [claims, tokenIds] = await Promise.all([
    gatherUserVaultClaims(reader, user),
    reader.listOwnerTokens(user)
  ]);

  const nftBalances = await Promise.all(
    tokenIds.map(async (tokenId) => ({
      tokenId,
      remainingUSDC: await reader.readNftBalance(tokenId)
    }))
  );

  return projectSessionPnl({
    claims,
    nftBalances,
    ...(investedUSDC === undefined ? {} : { investedUSDC })
  });
};
