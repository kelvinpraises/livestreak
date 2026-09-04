// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import { createPublicClient, http, type Abi } from "viem";

import { marketRegistryAbi } from "@livestreak/contracts/evm/abis";

import type { BookmakerChainConfig, BookmakerChainReader } from "../types.js";
import { validateBookmakerContractAddresses } from "./addresses.js";
import { validateMarketIdForContracts } from "./encode.js";

export const createEvmBookmakerReader = (config: BookmakerChainConfig): BookmakerChainReader => {
  if (config.walletInit.chain !== "evm") {
    throw new LiveStreakConfigError({
      message: "EVM bookmaker reader requires walletInit.chain === evm"
    });
  }

  const addresses = validateBookmakerContractAddresses(config.addresses);
  const rpcUrl = config.readRpcUrl ?? readRpcFromWalletInit(config);

  const client = createPublicClient({
    transport: http(rpcUrl)
  });

  return {
    marketExists: async (marketId: string) => {
      const marketIdBytes = validateMarketIdForContracts(marketId);
      return (await client.readContract({
        address: addresses.marketRegistry,
        abi: marketRegistryAbi as Abi,
        functionName: "marketExists",
        args: [marketIdBytes]
      })) as boolean;
    }
  };
};

// --- helpers ---

const readRpcFromWalletInit = (config: BookmakerChainConfig): string => {
  if (config.walletInit.chain !== "evm") {
    throw new LiveStreakConfigError({
      message: "EVM bookmaker reader requires walletInit.chain === evm"
    });
  }

  const provider = config.walletInit.config.provider;
  if (typeof provider !== "string" || provider.trim().length === 0) {
    throw new LiveStreakConfigError({
      message: "EVM bookmaker reader requires walletInit.config.provider or readRpcUrl"
    });
  }

  return provider.trim();
};
