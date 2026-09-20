// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import type { WalletInit } from "@livestreak/schema";

import {
  validateBookmakerSolanaAddresses,
  validateBookmakerSuiObjectIds,
  type BookmakerContractAddresses
} from "./addresses.js";
import type { BookmakerChainConfig } from "./types.js";
import { validateBookmakerContractAddresses } from "./evm/addresses.js";

export const validateBookmakerChainConfig = (input: unknown): BookmakerChainConfig => {
  if (!isPlainObject(input)) {
    throw new LiveStreakConfigError({
      message: "Bookmaker chain config must be a plain object",
      metadata: { details: describeValue(input) }
    });
  }

  const walletInit = input.walletInit;
  if (!isPlainObject(walletInit) || typeof walletInit.chain !== "string") {
    throw new LiveStreakConfigError({
      message: "Bookmaker chain config requires walletInit with a chain field",
      metadata: { details: describeValue(walletInit) }
    });
  }

  const seed = input.seed;
  if (typeof seed !== "string" && !(seed instanceof Uint8Array)) {
    throw new LiveStreakConfigError({
      message: "Bookmaker chain config requires seed as string or Uint8Array",
      metadata: { details: describeValue(seed) }
    });
  }

  if (!isPlainObject(input.addresses)) {
    throw new LiveStreakConfigError({
      message: "Bookmaker chain config requires addresses",
      metadata: { details: describeValue(input.addresses) }
    });
  }

  const addresses =
    walletInit.chain === "sui"
      ? validateBookmakerSuiObjectIds(input.addresses)
      : walletInit.chain === "solana"
        ? validateBookmakerSolanaAddresses(input.addresses)
        : validateBookmakerContractAddresses(input.addresses as unknown as BookmakerContractAddresses);

  const readRpcUrl =
    input.readRpcUrl === undefined
      ? undefined
      : requireNonEmptyString(input.readRpcUrl, "readRpcUrl");

  return {
    walletInit: walletInit as WalletInit,
    seed,
    addresses,
    ...(readRpcUrl === undefined ? {} : { readRpcUrl })
  };
};

const hasNonEmptyStrings = (value: unknown, keys: readonly string[]): boolean =>
  typeof value === "object" &&
  value !== null &&
  keys.every((key) => {
    const field = (value as Record<string, unknown>)[key];
    return typeof field === "string" && field.length > 0;
  });

// One complete per-chain shape: EVM contract addresses, Sui object ids, or the Solana program bag.
export const hasBookmakerChainAddresses = (
  addresses: unknown
): addresses is BookmakerChainConfig["addresses"] =>
  hasNonEmptyStrings(addresses, ["vaultDriver", "marketRegistry", "vault", "usdc"]) ||
  hasNonEmptyStrings(addresses, [
    "packageId",
    "vaultDriverRegistry",
    "vaultRegistry",
    "marketRegistry",
    "dripsRegistry",
    "streamsRegistry"
  ]) ||
  hasNonEmptyStrings(addresses, ["programId", "usdcMint"]);

// --- helpers ---

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const describeValue = (value: unknown): string => {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
};

const requireNonEmptyString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LiveStreakConfigError({
      message: `Bookmaker chain config requires a non-empty ${field}`,
      metadata: { details: describeValue(value) }
    });
  }

  return value.trim();
};
