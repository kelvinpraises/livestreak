// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import type { WalletInit } from "@livestreak/schema";

import type { StewardContractExecutor } from "../runtime/adapters/action-plan-sink.js";
import { createEvmStewardExecutor } from "./evm.js";
import { createSolanaStewardExecutor } from "./solana.js";
import { createSuiStewardExecutor } from "./sui.js";
import {
  validateStewardEvmAddresses,
  validateStewardSolanaAddresses,
  validateStewardSuiObjectIds,
  type StewardChainConfig
} from "./types.js";

export type {
  StewardChainConfig,
  StewardEvmAddresses,
  StewardSolanaAddresses,
  StewardSuiObjectIds
} from "./types.js";

export const validateStewardChainConfig = (config: StewardChainConfig): StewardChainConfig => {
  const addresses =
    config.walletInit.chain === "sui"
      ? validateStewardSuiObjectIds(config.addresses)
      : config.walletInit.chain === "solana"
        ? validateStewardSolanaAddresses(config.addresses)
        : validateStewardEvmAddresses(config.addresses);
  return { ...config, addresses };
};

// Chain-dispatched steward contract executor. Adding a chain = one more case (mirrors options/bookmaker).
export const createStewardContractExecutor = (config: StewardChainConfig): StewardContractExecutor => {
  const validated = validateStewardChainConfig(config);
  switch (validated.walletInit.chain) {
    case "evm":
      return createEvmStewardExecutor(validated);
    case "sui":
      return createSuiStewardExecutor(validated);
    case "solana":
      return createSolanaStewardExecutor(validated);
    default:
      return unreachableChain(validated.walletInit);
  }
};

const unreachableChain = (walletInit: WalletInit): never => {
  throw new LiveStreakConfigError({
    message: `Unsupported wallet chain for steward executor: ${String(walletInit.chain)}`
  });
};
