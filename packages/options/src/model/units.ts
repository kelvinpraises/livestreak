// --- exports ---

import type { ContractChain } from "../chains/types.js";
import { SHARE_SCALE } from "./math/curve.js";

// USDC and protocol shares are 6-decimal on every chain. LVST decimals are chain-LOCAL (contracts D2):
// EVM = 18, Sui/Solana = 9. The board normalizes with these so no consumer carries a decimals table.
const USDC_SCALE = 1_000_000;
const LVST_DECIMALS: Record<ContractChain, number> = { evm: 18, sui: 9, solana: 9 };

export const lvstDecimalsForChain = (chain: ContractChain): number => LVST_DECIMALS[chain];

/** USDC base units → whole USDC. */
export const usdcToNumber = (raw: bigint): number => Number(raw) / USDC_SCALE;

/** Protocol shares (1e6) → whole shares. */
export const sharesToNumber = (raw: bigint): number => Number(raw) / Number(SHARE_SCALE);

/** LVST base units → whole LVST, at the chain's decimals. */
export const lvstToNumber = (raw: bigint, decimals: number): number => Number(raw) / 10 ** decimals;

/** Stream rate in USDC base units/sec → USDC/min. */
export const rateToPerMinUSDC = (ratePerSecRaw: bigint): number => (Number(ratePerSecRaw) * 60) / USDC_SCALE;

/** USDC/min → stream rate in USDC base units/sec (floored at 1 — the contract rejects rate 0). */
export const perMinUSDCToRate = (usdPerMin: number): bigint =>
  BigInt(Math.max(1, Math.round((usdPerMin * USDC_SCALE) / 60)));

/** Whole USDC → base units. */
export const usdcToRaw = (usd: number): bigint => BigInt(Math.round(usd * USDC_SCALE));
