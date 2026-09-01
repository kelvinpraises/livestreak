// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { MarketId, VaultId } from "./ids.js";

export const OPTIONS_VAULT_SIDES = ["yes", "no"] as const;

export type OptionsVaultSide = (typeof OPTIONS_VAULT_SIDES)[number];

export type OptionsVaultStatus = "open" | "hot" | "locked" | "resolved" | "disputed";

export type OptionsVaultOutcome = "pending" | "yes" | "no";

export type OptionsVaultType =
  | "momentum"
  | "player"
  | "threshold"
  | "timing"
  | "swing"
  | (string & {});

export interface OptionsVaultPools {
  readonly yes: bigint;
  readonly no: bigint;
}

export interface OptionsVaultTiming {
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly lockedAtMs?: number;
  readonly resolvedAtMs?: number;
}

export interface OptionsVaultStewardState {
  readonly stewardId?: string;
  readonly hot: boolean;
  readonly hotUntilMs?: number;
  readonly hotReason?: string;
  readonly exitBurnBps?: number;
  readonly disputeId?: string;
}

export interface OptionsVault {
  readonly vaultId: VaultId;
  readonly marketId: MarketId;
  readonly question: string;
  readonly type: OptionsVaultType;
  readonly creator: string;
  readonly status: OptionsVaultStatus;
  readonly outcome: OptionsVaultOutcome;
  readonly pools: OptionsVaultPools;
  readonly timing: OptionsVaultTiming;
  readonly steward: OptionsVaultStewardState;
}

export const isOptionsVaultSide = (value: unknown): value is OptionsVaultSide =>
  value === "yes" || value === "no";

export const validateOptionsVaultSide = (value: unknown): OptionsVaultSide => {
  if (isOptionsVaultSide(value)) {
    return value;
  }

  throw new LiveStreakConfigError({
    message: "Invalid vault side",
    metadata: { details: `Expected "yes" or "no", received ${String(value)}` }
  });
};

export const totalVaultPool = (pools: OptionsVaultPools): bigint => pools.yes + pools.no;
