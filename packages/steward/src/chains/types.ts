// --- exports ---

import type { WalletInit } from "@livestreak/schema";
import { LiveStreakConfigError } from "@livestreak/core";

export interface StewardEvmAddresses {
  readonly stewardRegistry: string;
}

export interface StewardSuiObjectIds {
  readonly packageId: string;
  readonly stewardRegistry: string;
  readonly vaultRegistry: string;
}

export interface StewardChainConfig {
  readonly walletInit: WalletInit;
  readonly seed: string | Uint8Array;
  readonly addresses: StewardEvmAddresses | StewardSuiObjectIds;
}

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SUI_OBJECT_ID_RE = /^0x[0-9a-fA-F]{64}$/;

export const validateStewardEvmAddresses = (input: unknown): StewardEvmAddresses => {
  const record = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const stewardRegistry = typeof record.stewardRegistry === "string" ? record.stewardRegistry.trim() : "";
  if (!EVM_ADDRESS_RE.test(stewardRegistry)) {
    throw new LiveStreakConfigError({
      message: "Steward EVM config requires a valid stewardRegistry address",
      metadata: { details: stewardRegistry }
    });
  }
  return { stewardRegistry };
};

export const validateStewardSuiObjectIds = (input: unknown): StewardSuiObjectIds => {
  const record = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const require = (key: keyof StewardSuiObjectIds): string => {
    const value = typeof record[key] === "string" ? (record[key] as string).trim() : "";
    if (!SUI_OBJECT_ID_RE.test(value)) {
      throw new LiveStreakConfigError({
        message: `Steward Sui config requires a valid ${String(key)} object id`,
        metadata: { details: value }
      });
    }
    return value;
  };
  return {
    packageId: require("packageId"),
    stewardRegistry: require("stewardRegistry"),
    vaultRegistry: require("vaultRegistry")
  };
};
