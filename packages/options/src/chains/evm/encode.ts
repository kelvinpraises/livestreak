// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { MarketId, TokenId, UserAddress, VaultId } from "../../model/ids.js";
import type { OptionsVaultSide } from "../../model/vault.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

export type ContractSide = "yes" | "no";

export const sideToSolidityValue = (side: ContractSide): 0 | 1 =>
  side === "yes" ? 0 : 1;

export const sideFromSolidityValue = (value: number): ContractSide => {
  if (value === 0) {
    return "yes";
  }

  if (value === 1) {
    return "no";
  }

  throw new Error(`Invalid Side enum value: ${value}`);
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

export const validateTokenIdForContracts = (tokenId: TokenId): bigint => {
  if (typeof tokenId !== "bigint" || tokenId < 0n) {
    throw new LiveStreakConfigError({
      message: "Invalid tokenId",
      metadata: { details: String(tokenId) }
    });
  }

  return tokenId;
};

// MarketDriver.mintWithSalt(bytes32, uint64 salt, address). The salt is a uint64 — reject anything
// outside [0, 2^64-1] before it reaches the ABI encoder.
const MAX_UINT64 = (1n << 64n) - 1n;

export const validateUint64Salt = (value: bigint, field = "salt"): bigint => {
  if (typeof value !== "bigint" || value < 0n || value > MAX_UINT64) {
    throw new LiveStreakConfigError({
      message: `Invalid uint64 ${field} (must be 0 .. 2^64-1)`,
      metadata: { details: String(value) }
    });
  }

  return value;
};

export const coerceVaultSide = (side: OptionsVaultSide): ContractSide => side;
