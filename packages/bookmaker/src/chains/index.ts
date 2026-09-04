// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import type { WalletInit } from "@livestreak/schema";

import { validateBookmakerChainConfig } from "./config.js";
import { createEvmBookmakerChain } from "./evm/index.js";
import { createSuiBookmakerChain } from "./sui/index.js";
import type { BookmakerChain, BookmakerChainConfig } from "./types.js";

export type { BookmakerContractAddresses } from "./addresses.js";
export { hasBookmakerChainAddresses, validateBookmakerChainConfig } from "./config.js";
export type {
  BookmakerChain,
  BookmakerChainConfig,
  BookmakerChainReader,
  BookmakerChainWriter,
  CreateVaultInput,
  CreateVaultResult,
  TxId,
  VaultId
} from "./types.js";
export { asTxId, asVaultId } from "./types.js";

export const createBookmakerChain = (config: BookmakerChainConfig): BookmakerChain => {
  const validated = validateBookmakerChainConfig(config);
  const walletInit = validated.walletInit;

  switch (walletInit.chain) {
    case "evm": {
      return createEvmBookmakerChain({ ...validated, walletInit });
    }
    case "sui": {
      void walletInit;
      return createSuiBookmakerChain();
    }
    default: {
      return unreachableChain(walletInit);
    }
  }
};

// --- helpers ---

const unreachableChain = (walletInit: WalletInit): never => {
  throw new LiveStreakConfigError({
    message: `Unsupported wallet chain for bookmaker: ${String(walletInit.chain)}`
  });
};
