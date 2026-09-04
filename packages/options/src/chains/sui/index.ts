// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { OptionsChain, OptionsReader, OptionsWriter } from "../types.js";

const notImplemented = (operation: string): (() => Promise<never>) => async () => {
  throw new LiveStreakConfigError({
    message: `Sui options chain: ${operation} is not implemented`
  });
};

const createNotImplementedReader = (): OptionsReader => ({
  readMarket: notImplemented("readMarket"),
  readStreamState: notImplemented("readStreamState"),
  listMarketVaults: notImplemented("listMarketVaults"),
  readVault: notImplemented("readVault"),
  readVaultShareTotals: notImplemented("readVaultShareTotals"),
  listOwnerTokens: notImplemented("listOwnerTokens"),
  readNft: notImplemented("readNft"),
  readLvstAccount: notImplemented("readLvstAccount"),
  readClaimable: notImplemented("readClaimable"),
  readLossClaimable: notImplemented("readLossClaimable"),
  readPot: notImplemented("readPot"),
  readCollected: notImplemented("readCollected"),
  readAccountVaultIds: notImplemented("readAccountVaultIds"),
  readWinningSide: notImplemented("readWinningSide"),
  readBoard: notImplemented("readBoard"),
  readSharePrice: notImplemented("readSharePrice"),
  readPendingShares: notImplemented("readPendingShares"),
  readUsdcAddress: notImplemented("readUsdcAddress"),
  readUsdcBalance: notImplemented("readUsdcBalance"),
  readNftBalance: notImplemented("readNftBalance"),
  readOwnerOf: notImplemented("readOwnerOf"),
  readApproved: notImplemented("readApproved"),
  readIsApprovedForAll: notImplemented("readIsApprovedForAll")
});

const createNotImplementedWriter = (): OptionsWriter => ({
  mint: notImplemented("mint"),
  fund: notImplemented("fund"),
  setLanes: notImplemented("setLanes"),
  stopFunding: notImplemented("stopFunding"),
  stopAllFunding: notImplemented("stopAllFunding"),
  withdraw: notImplemented("withdraw"),
  withdrawMany: notImplemented("withdrawMany"),
  claimLossLvst: notImplemented("claimLossLvst"),
  stakeLvst: notImplemented("stakeLvst"),
  unstakeLvst: notImplemented("unstakeLvst"),
  claimDividends: notImplemented("claimDividends"),
  transferNft: notImplemented("transferNft"),
  approveNft: notImplemented("approveNft"),
  setApprovalForAll: notImplemented("setApprovalForAll")
});

export const createSuiOptionsChain = (): OptionsChain => ({
  reader: createNotImplementedReader(),
  writer: createNotImplementedWriter()
});
