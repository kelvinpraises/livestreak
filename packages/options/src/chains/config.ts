// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import { asUserAddress } from "../model/ids.js";
import type { OptionsChainConfig } from "./types.js";
import { validateOptionsContractAddresses } from "./evm/addresses.js";

export const validateOptionsChainConfig = (input: unknown): OptionsChainConfig => {
  if (!isPlainObject(input)) {
    throw new LiveStreakConfigError({
      message: "Options chain config must be a plain object",
      metadata: { details: describeValue(input) }
    });
  }

  const walletInit = input.walletInit;
  if (!isPlainObject(walletInit) || typeof walletInit.chain !== "string") {
    throw new LiveStreakConfigError({
      message: "Options chain config requires walletInit with a chain field",
      metadata: { details: describeValue(walletInit) }
    });
  }

  const seed = input.seed;
  if (typeof seed !== "string" && !(seed instanceof Uint8Array)) {
    throw new LiveStreakConfigError({
      message: "Options chain config requires seed as string or Uint8Array",
      metadata: { details: describeValue(seed) }
    });
  }

  if (!isPlainObject(input.addresses)) {
    throw new LiveStreakConfigError({
      message: "Options chain config requires addresses",
      metadata: { details: describeValue(input.addresses) }
    });
  }

  const addresses = validateOptionsContractAddresses(
    input.addresses as OptionsChainConfig["addresses"]
  );

  const readRpcUrl =
    input.readRpcUrl === undefined
      ? undefined
      : requireNonEmptyString(input.readRpcUrl, "readRpcUrl");

  const transferOperator =
    input.transferOperator === undefined
      ? undefined
      : asUserAddress(requireNonEmptyString(input.transferOperator, "transferOperator"));

  return {
    walletInit: walletInit as OptionsChainConfig["walletInit"],
    seed,
    addresses,
    ...(readRpcUrl === undefined ? {} : { readRpcUrl }),
    ...(input.includeProtocolSummary === true ? { includeProtocolSummary: true } : {}),
    ...(transferOperator === undefined ? {} : { transferOperator })
  };
};

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
      message: `Options chain config requires a non-empty ${field}`,
      metadata: { details: describeValue(value) }
    });
  }

  return value.trim();
};
