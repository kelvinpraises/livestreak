// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import { createWalletManager, type SuiWalletConfig } from "@livestreak/wallet";

import { asUserAddress, type UserAddress } from "../../model/ids.js";
import type { OptionsChainConfig } from "../types.js";

// Sui addresses: 0x + 64 hex chars (32-byte Ed25519 public key hash).
const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

export const validateSuiUserAddress = (value: string, field = "address"): UserAddress => {
  if (!SUI_ADDRESS_RE.test(value)) {
    throw new LiveStreakConfigError({
      message: `Invalid Sui address for ${field}`,
      metadata: { details: value }
    });
  }

  return asUserAddress(value);
};

export const resolveSuiAccountAddress = async (
  config: OptionsChainConfig
): Promise<UserAddress> => {
  if (config.walletInit.chain !== "sui") {
    throw new LiveStreakConfigError({
      message: "Sui account resolution requires walletInit.chain === sui"
    });
  }

  const suiConfig = config.walletInit.config as SuiWalletConfig;
  const manager = createWalletManager("sui", config.seed, suiConfig);
  const account = await manager.getAccount();
  const address = await account.getAddress();

  return validateSuiUserAddress(address, "account");
};
