// --- exports ---

import type { WalletInit } from "@livestreak/schema";
import { LiveStreakConfigError } from "@livestreak/core";

import type { StewardFindingSeverity } from "../model/finding.js";

// StewardRegistry severity enum on both chains: Warm = 0, Hot = 1, Critical = 2.
export const severityToContractValue = (severity: StewardFindingSeverity): number => {
  switch (severity) {
    case "critical":
      return 2;
    case "warning":
      return 1;
    case "info":
      return 0;
  }
};

export interface StewardEvmAddresses {
  readonly stewardRegistry: string;
}

export interface StewardSuiObjectIds {
  readonly packageId: string;
  readonly stewardRegistry: string;
  readonly vaultRegistry: string;
}

export interface StewardSolanaAddresses {
  readonly programId: string;
  readonly usdcMint: string;
  // Solana-only: the program partitions vaults by market (protocol_state + steward-override PDAs
  // seed by market_id) while StewardContractCall carries only [vaultId, outcome]. The executor
  // resolves the vault's market AT CALL TIME by scanning the on-chain market ledger (options-leg
  // parity), so no marketId rides the config and the executor stays market-agnostic like EVM/Sui.
}

export interface StewardChainConfig {
  readonly walletInit: WalletInit;
  readonly seed: string | Uint8Array;
  readonly addresses: StewardEvmAddresses | StewardSuiObjectIds | StewardSolanaAddresses;
}

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SUI_OBJECT_ID_RE = /^0x[0-9a-fA-F]{64}$/;
// base58, 32-44 chars (excludes 0 O I l) — the canonical Solana pubkey shape.
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HEX32_RE = /^0x[0-9a-fA-F]{64}$/;

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

export const validateStewardSolanaAddresses = (input: unknown): StewardSolanaAddresses => {
  const record = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const require = (key: keyof StewardSolanaAddresses, re: RegExp, kind: string): string => {
    const value = typeof record[key] === "string" ? (record[key] as string).trim() : "";
    if (!re.test(value)) {
      throw new LiveStreakConfigError({
        message: `Steward Solana config requires a valid ${kind} ${String(key)}`,
        metadata: { details: value }
      });
    }
    return value;
  };
  return {
    programId: require("programId", SOLANA_ADDRESS_RE, "base58"),
    usdcMint: require("usdcMint", SOLANA_ADDRESS_RE, "base58")
  };
};
