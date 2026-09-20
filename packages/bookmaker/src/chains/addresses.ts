// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";
// Multichain-hygiene: base58 validation via @livestreak/wallet's re-exported kit `address`
// (the single @solana/* owner). It brands + throws on a malformed pubkey.
import { address as solanaAddress } from "@livestreak/wallet";

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

// The Solana ids the bookmaker needs for create_vault_seeded: the program + the USDC mint.
// Escrow/protocol/market accounts are all PDAs derived from these (see the wallet livestreak
// PDA helpers), so — unlike EVM/Sui — the bookmaker needs no per-account address here.
export interface BookmakerSolanaAddresses {
  readonly programId: string;
  readonly usdcMint: string;
}

// 0x + 64 hex — Sui object ids are 32-byte hashes.
const SUI_OBJECT_ID_RE = /^0x[0-9a-fA-F]{64}$/;

export const validateBookmakerSolanaAddresses = (input: unknown): BookmakerSolanaAddresses => {
  if (typeof input !== "object" || input === null) {
    throw new LiveStreakConfigError({ message: "Bookmaker Solana addresses must be an object" });
  }
  const record = input as Record<string, unknown>;
  const requireBase58 = (key: keyof BookmakerSolanaAddresses): string => {
    const value = record[key];
    if (typeof value !== "string") {
      throw new LiveStreakConfigError({
        message: `Invalid Solana address for bookmaker "${String(key)}"`,
        metadata: { details: String(value) }
      });
    }
    try {
      // `address()` throws on a non-base58 / wrong-length pubkey — the canonical validator.
      return solanaAddress(value);
    } catch (error) {
      throw new LiveStreakConfigError({
        message: `Invalid Solana address for bookmaker "${String(key)}"`,
        metadata: { details: error instanceof Error ? error.message : String(value) }
      });
    }
  };
  return {
    programId: requireBase58("programId"),
    usdcMint: requireBase58("usdcMint")
  };
};

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
