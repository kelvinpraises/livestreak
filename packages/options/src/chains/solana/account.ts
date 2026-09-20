// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import {
  address,
  createWalletManager,
  type LiveStreakSolanaWalletConfig
} from "@livestreak/wallet";

import { asUserAddress, type UserAddress } from "../../model/ids.js";
import type { OptionsChainConfig } from "../types.js";

// OPT.sui-validate parity for Solana: validate the base58 pubkey via the wallet's re-exported kit
// `address()` (throws on malformed/wrong-length) before it is used as a signer/owner id.
export const validateSolanaUserAddress = (value: string, field = "address"): UserAddress => {
  try {
    return asUserAddress(String(address(value)));
  } catch (error) {
    throw new LiveStreakConfigError({
      message: `Invalid Solana address for ${field} (expected a base58 pubkey)`,
      metadata: { details: value, cause: error }
    });
  }
};

export const resolveSolanaAccountAddress = async (
  config: OptionsChainConfig
): Promise<UserAddress> => {
  if (config.walletInit.chain !== "solana") {
    throw new LiveStreakConfigError({
      message: "Solana account resolution requires walletInit.chain === solana"
    });
  }
  const solanaConfig = config.walletInit.config as LiveStreakSolanaWalletConfig;
  const manager = createWalletManager("solana", config.seed, solanaConfig);
  const account = await manager.getAccount();
  const addr = await account.getAddress();
  return validateSolanaUserAddress(addr, "account");
};
