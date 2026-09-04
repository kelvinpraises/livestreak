// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export type OptionsContractAddresses = {
  readonly marketRegistry: `0x${string}`;
  readonly vault: `0x${string}`;
  readonly marketDriver: `0x${string}`;
  readonly stewardRegistry: `0x${string}`;
  readonly treasury: `0x${string}`;
  readonly lvstToken: `0x${string}`;
  readonly dripsStreaming: `0x${string}`;
};

export const validateContractAddress = (
  value: string,
  field: string
): `0x${string}` => {
  if (!ADDRESS_RE.test(value)) {
    throw new LiveStreakConfigError({
      message: `Invalid contract address for ${field}`,
      metadata: { details: value }
    });
  }

  return value as `0x${string}`;
};

export const validateOptionsContractAddresses = (
  addresses: OptionsContractAddresses
): OptionsContractAddresses => ({
  marketRegistry: validateContractAddress(addresses.marketRegistry, "marketRegistry"),
  vault: validateContractAddress(addresses.vault, "vault"),
  marketDriver: validateContractAddress(addresses.marketDriver, "marketDriver"),
  stewardRegistry: validateContractAddress(addresses.stewardRegistry, "stewardRegistry"),
  treasury: validateContractAddress(addresses.treasury, "treasury"),
  lvstToken: validateContractAddress(addresses.lvstToken, "lvstToken"),
  dripsStreaming: validateContractAddress(addresses.dripsStreaming, "dripsStreaming")
});
