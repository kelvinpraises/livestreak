// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import type { LiveStreakSolanaWalletConfig } from "@livestreak/wallet";

import type { BookmakerChain, BookmakerChainConfig } from "../types.js";
import type { BookmakerSolanaAddresses } from "../addresses.js";
import { createSolanaBookmakerReader } from "./reader.js";
import { createSolanaBookmakerWriter } from "./writer.js";

// Resolve the read RPC endpoint the same way the sui leg does: an explicit readRpcUrl wins,
// else the wallet config's provider/rpcUrl (first entry if an array).
export const resolveSolanaRpcUrl = (config: BookmakerChainConfig): string => {
  const solanaConfig = config.walletInit.config as LiveStreakSolanaWalletConfig;
  const fromConfig = solanaConfig.provider ?? solanaConfig.rpcUrl;
  const first = Array.isArray(fromConfig) ? fromConfig[0] : fromConfig;
  return config.readRpcUrl ?? first ?? "";
};

export const createSolanaBookmakerChain = (config: BookmakerChainConfig): BookmakerChain => {
  if (config.walletInit.chain !== "solana") {
    throw new LiveStreakConfigError({
      message: "Solana bookmaker chain requires walletInit.chain === solana"
    });
  }

  const addresses = config.addresses as BookmakerSolanaAddresses;
  const rpcUrl = resolveSolanaRpcUrl(config);

  return {
    reader: createSolanaBookmakerReader(addresses, rpcUrl),
    writer: createSolanaBookmakerWriter(config)
  };
};
