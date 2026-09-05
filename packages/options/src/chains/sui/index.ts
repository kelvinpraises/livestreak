// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { OptionsChain, OptionsChainConfig, OptionsReader, OptionsWriter } from "../types.js";
import type { OptionsSuiObjectIds } from "./addresses.js";
import { createSuiOptionsReader } from "./reader.js";
import { createSuiOptionsWriter } from "./writer.js";

export const createSuiOptionsChain = (config?: OptionsChainConfig): OptionsChain => {
  if (config === undefined) {
    return {
      reader: createNotImplementedReader(),
      writer: createNotImplementedWriter()
    };
  }

  if (config.walletInit.chain !== "sui") {
    throw new LiveStreakConfigError({
      message: "Sui options chain requires walletInit.chain === sui"
    });
  }

  const suiConfig = config.walletInit.config as { rpcUrl?: string | string[] };
  const rpcUrl =
    config.readRpcUrl ??
    (Array.isArray(suiConfig.rpcUrl) ? suiConfig.rpcUrl[0] : suiConfig.rpcUrl) ??
    "http://127.0.0.1:9000";

  const ids = config.addresses as OptionsSuiObjectIds;

  return {
    reader: createSuiOptionsReader(ids, rpcUrl),
    writer: createSuiOptionsWriter(config)
  };
};

// --- helpers ---

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
  readPendingBoundaries: notImplemented("readPendingBoundaries"),
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
  mintWithSalt: notImplemented("mintWithSalt"),
  fund: notImplemented("fund"),
  advance: notImplemented("advance"),
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
