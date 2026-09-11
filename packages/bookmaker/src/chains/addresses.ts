// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

export interface BookmakerContractAddresses {
  readonly vaultDriver: string;
  readonly marketRegistry: string;
  readonly vault: string;
  readonly usdc: string;
}

// Sui object ids the bookmaker needs for vault_driver::create_vault. Scoped to bookmaker's surface
// (vault origination), mirroring the shape of OptionsSuiObjectIds.
export interface BookmakerSuiObjectIds {
  readonly packageId: string;
  readonly vaultDriverRegistry: string;
  readonly vaultRegistry: string;
  readonly marketRegistry: string;
  readonly dripsRegistry: string;
  readonly streamsRegistry: string;
}

// 0x + 64 hex — Sui object ids are 32-byte hashes.
const SUI_OBJECT_ID_RE = /^0x[0-9a-fA-F]{64}$/;

export const validateBookmakerSuiObjectIds = (input: unknown): BookmakerSuiObjectIds => {
  if (typeof input !== "object" || input === null) {
    throw new LiveStreakConfigError({ message: "Bookmaker Sui object ids must be an object" });
  }
  const record = input as Record<string, unknown>;
  const require = (key: keyof BookmakerSuiObjectIds): string => {
    const value = record[key];
    if (typeof value !== "string" || !SUI_OBJECT_ID_RE.test(value)) {
      throw new LiveStreakConfigError({
        message: `Invalid Sui object id for bookmaker "${String(key)}"`,
        metadata: { details: String(value) }
      });
    }
    return value;
  };
  return {
    packageId: require("packageId"),
    vaultDriverRegistry: require("vaultDriverRegistry"),
    vaultRegistry: require("vaultRegistry"),
    marketRegistry: require("marketRegistry"),
    dripsRegistry: require("dripsRegistry"),
    streamsRegistry: require("streamsRegistry")
  };
};
