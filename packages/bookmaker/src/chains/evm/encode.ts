// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

const MAX_DEPOSIT = BigInt("0x7fffffffffffffffffffffffffffffff");

export type ContractSide = "yes" | "no";

export const sideToSolidityValue = (side: ContractSide): 0 | 1 =>
  side === "yes" ? 0 : 1;

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

export const validateMarketIdForContracts = (marketId: string): `0x${string}` => {
  if (!BYTES32_RE.test(marketId)) {
    throw new LiveStreakConfigError({
      message: "Invalid bytes32 id for marketId",
      metadata: { details: marketId }
    });
  }

  return marketId as `0x${string}`;
};

export const validateDepositBounds = (deposit: bigint): bigint => {
  if (typeof deposit !== "bigint" || deposit <= 0n || deposit > MAX_DEPOSIT) {
    throw new LiveStreakConfigError({
      message: "createVault deposit must be > 0 and within int128 bounds",
      metadata: { details: String(deposit) }
    });
  }

  return deposit;
};

export const validateSeedRate = (rate: bigint): bigint => {
  if (typeof rate !== "bigint" || rate <= 0n) {
    throw new LiveStreakConfigError({
      message: "createVault rate must be a bigint > 0",
      metadata: { details: String(rate) }
    });
  }

  return rate;
};
