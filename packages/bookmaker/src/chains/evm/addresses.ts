// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { BookmakerContractAddresses, BookmakerSuiObjectIds } from "../addresses.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const validateBookmakerContractAddresses = (
  input: BookmakerContractAddresses | BookmakerSuiObjectIds
): {
  readonly vaultDriver: `0x${string}`;
  readonly marketRegistry: `0x${string}`;
  readonly vault: `0x${string}`;
  readonly usdc: `0x${string}`;
} => {
  // Callers (the EVM reader/writer) have already asserted walletInit.chain === "evm".
  const evm = input as BookmakerContractAddresses;
  return {
    vaultDriver: validateContractAddress(evm.vaultDriver, "vaultDriver"),
    marketRegistry: validateContractAddress(evm.marketRegistry, "marketRegistry"),
    vault: validateContractAddress(evm.vault, "vault"),
    usdc: validateContractAddress(evm.usdc, "usdc")
  };
};

// --- helpers ---

const validateContractAddress = (value: string, field: string): `0x${string}` => {
  if (!ADDRESS_RE.test(value)) {
    throw new LiveStreakConfigError({
      message: `Invalid contract address for ${field}`,
      metadata: { details: value }
    });
  }

  return value as `0x${string}`;
};
