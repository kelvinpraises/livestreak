// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { MarketId, UserAddress, VaultId } from "../../model/ids.js";
import type { LivestreakContractAddresses } from "./addresses.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

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

export const validateBytes32Id = (value: string, field: string): `0x${string}` => {
  if (!BYTES32_RE.test(value)) {
    throw new LiveStreakConfigError({
      message: `Invalid bytes32 id for ${field}`,
      metadata: { details: value }
    });
  }

  return value as `0x${string}`;
};

export const validateUserAddress = (value: string, field = "user"): UserAddress => {
  validateContractAddress(value, field);
  return value as UserAddress;
};

export const validateMarketIdForContracts = (marketId: MarketId): `0x${string}` =>
  validateBytes32Id(marketId, "marketId");

export const validateVaultIdForContracts = (vaultId: VaultId): `0x${string}` =>
  validateBytes32Id(vaultId, "vaultId");

export const validateLivestreakContractAddresses = (
  addresses: LivestreakContractAddresses
): LivestreakContractAddresses => ({
  marketRegistry: validateContractAddress(addresses.marketRegistry, "marketRegistry"),
  bookmakerRegistry: validateContractAddress(addresses.bookmakerRegistry, "bookmakerRegistry"),
  vaultFactory: validateContractAddress(addresses.vaultFactory, "vaultFactory"),
  vault: validateContractAddress(addresses.vault, "vault"),
  vaultFunding: validateContractAddress(addresses.vaultFunding, "vaultFunding"),
  flowToken: validateContractAddress(addresses.flowToken, "flowToken"),
  stewardRegistry: validateContractAddress(addresses.stewardRegistry, "stewardRegistry")
});
