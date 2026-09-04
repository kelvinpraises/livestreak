// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import { createWalletManager, type EvmErc4337WalletConfig } from "@livestreak/wallet";

import type { UserAddress } from "../../model/ids.js";
import type { OptionsChainConfig } from "../types.js";
import { validateUserAddress } from "./encode.js";

export const resolveEvmAccountAddress = async (
  config: OptionsChainConfig
): Promise<UserAddress> => {
  if (config.walletInit.chain !== "evm") {
    throw new LiveStreakConfigError({
      message: "EVM account resolution requires walletInit.chain === evm"
    });
  }

  const evmConfig = config.walletInit.config as EvmErc4337WalletConfig;
  const manager = createWalletManager("evm", config.seed, evmConfig);
  const account = await manager.getAccount();
  const readOnly = await account.toReadOnlyAccount();
  const address = await readOnly.getAddress();

  return validateUserAddress(address, "account");
};
