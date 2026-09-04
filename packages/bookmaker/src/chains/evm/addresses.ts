// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { BookmakerContractAddresses } from "../addresses.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const validateBookmakerContractAddresses = (
  input: BookmakerContractAddresses
): {
  readonly vaultDriver: `0x${string}`;
  readonly marketRegistry: `0x${string}`;
  readonly vault: `0x${string}`;
  readonly usdc: `0x${string}`;
} => ({
  vaultDriver: validateContractAddress(input.vaultDriver, "vaultDriver"),
  marketRegistry: validateContractAddress(input.marketRegistry, "marketRegistry"),
  vault: validateContractAddress(input.vault, "vault"),
  usdc: validateContractAddress(input.usdc, "usdc")
});

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
