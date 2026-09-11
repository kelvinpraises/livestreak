// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
import type { WalletInit } from "@livestreak/schema";

import { validateBookmakerSuiObjectIds, type BookmakerContractAddresses } from "./addresses.js";
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

export const hasBookmakerChainAddresses = (addresses: unknown): addresses is BookmakerContractAddresses =>
  typeof addresses === "object" &&
  addresses !== null &&
  typeof (addresses as BookmakerContractAddresses).vaultDriver === "string" &&
  (addresses as BookmakerContractAddresses).vaultDriver.length > 0 &&
  typeof (addresses as BookmakerContractAddresses).marketRegistry === "string" &&
  (addresses as BookmakerContractAddresses).marketRegistry.length > 0 &&
  typeof (addresses as BookmakerContractAddresses).vault === "string" &&
  (addresses as BookmakerContractAddresses).vault.length > 0 &&
  typeof (addresses as BookmakerContractAddresses).usdc === "string" &&
  (addresses as BookmakerContractAddresses).usdc.length > 0;

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
