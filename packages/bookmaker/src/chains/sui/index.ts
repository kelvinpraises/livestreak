// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import { type SuiWalletConfig } from "@livestreak/wallet";

import type { BookmakerChain, BookmakerChainConfig } from "../types.js";
import type { BookmakerSuiObjectIds } from "../addresses.js";
import { createSuiBookmakerReader } from "./reader.js";
import { createSuiBookmakerWriter } from "./writer.js";

export const createSuiBookmakerChain = (config: BookmakerChainConfig): BookmakerChain => {
  if (config.walletInit.chain !== "sui") {
    throw new LiveStreakConfigError({
      message: "Sui bookmaker chain requires walletInit.chain === sui"
    });
  }

  const suiConfig = config.walletInit.config as SuiWalletConfig;
  const rpcUrl =
    config.readRpcUrl ??
    (Array.isArray(suiConfig.rpcUrl) ? suiConfig.rpcUrl[0] : suiConfig.rpcUrl) ??
    "";
  const ids = config.addresses as BookmakerSuiObjectIds;

  return {
    reader: createSuiBookmakerReader(ids, rpcUrl),
    writer: createSuiBookmakerWriter(config)
  };
};
