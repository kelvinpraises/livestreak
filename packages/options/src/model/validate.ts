// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { MarketId, TokenId, UserAddress, VaultId } from "./ids.js";
import type { OptionsVaultSide } from "./vault.js";
import { validateOptionsVaultSide } from "./vault.js";

export const validateRate = (rate: bigint, field = "rate"): bigint => {
  if (typeof rate !== "bigint" || rate <= 0n) {
    throw new LiveStreakConfigError({
      message: `Options requires ${field} to be a bigint > 0`,
      metadata: { details: String(rate) }
    });
  }

  return rate;
};

export const validateNonNegativeAmount = (amount: bigint, field: string): bigint => {
  if (typeof amount !== "bigint" || amount < 0n) {
    throw new LiveStreakConfigError({
      message: `Options requires ${field} to be a bigint >= 0`,
      metadata: { details: String(amount) }
    });
  }

  return amount;
};

export const validateTokenId = (tokenId: TokenId): TokenId => {
  if (typeof tokenId !== "bigint" || tokenId < 0n) {
    throw new LiveStreakConfigError({
      message: "Invalid tokenId",
      metadata: { details: String(tokenId) }
    });
  }

  return tokenId;
};

export const requireNonEmptyId = <T extends string>(value: T, field: string): T => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LiveStreakConfigError({
      message: `Options requires a non-empty ${field}`,
      metadata: { details: String(value) }
    });
  }

  return value;
};

export const validateMarketId = (marketId: MarketId): MarketId =>
  requireNonEmptyId(marketId, "marketId");

export const validateVaultId = (vaultId: VaultId): VaultId => requireNonEmptyId(vaultId, "vaultId");

export const validateUser = (user: UserAddress): UserAddress => requireNonEmptyId(user, "user");

export const validateVaultSide = (side: OptionsVaultSide): OptionsVaultSide =>
  validateOptionsVaultSide(side);
