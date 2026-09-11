// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import type { WalletInit } from "@livestreak/schema";

import type { StewardContractExecutor } from "../runtime/adapters/action-plan-sink.js";
import { createEvmStewardExecutor } from "./evm.js";
import { createSuiStewardExecutor } from "./sui.js";
import {
  validateStewardEvmAddresses,
  validateStewardSuiObjectIds,
  type StewardChainConfig
} from "./types.js";

export type { StewardChainConfig, StewardEvmAddresses, StewardSuiObjectIds } from "./types.js";

export const validateStewardChainConfig = (config: StewardChainConfig): StewardChainConfig => ({
  ...config,
  addresses:
    config.walletInit.chain === "sui"
      ? validateStewardSuiObjectIds(config.addresses)
      : validateStewardEvmAddresses(config.addresses)
});

// Chain-dispatched steward contract executor. Adding a chain = one more case (mirrors options/bookmaker).
export const createStewardContractExecutor = (config: StewardChainConfig): StewardContractExecutor => {
  const validated = validateStewardChainConfig(config);
  switch (validated.walletInit.chain) {
    case "evm":
      return createEvmStewardExecutor(validated);
    case "sui":
      return createSuiStewardExecutor(validated);
    default:
      return unreachableChain(validated.walletInit);
  }
};

const unreachableChain = (walletInit: WalletInit): never => {
  throw new LiveStreakConfigError({
    message: `Unsupported wallet chain for steward executor: ${String(walletInit.chain)}`
  });
};
