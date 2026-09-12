import {
  projectVaultLivePools,
  type OptionsVault,
  type OptionsVaultSnapshot
} from "@livestreak/options";

// USDC base unit scale (6 decimals) — vault pools are bigint USDC base units on all chains.
const USDC_SCALE = 1_000_000;

export const usdcFromBase = (value: bigint): number => Number(value) / USDC_SCALE;

/** Cent-rounded USDC float from a vault pool total in base units. */
export const vaultPoolUsdc = (yes: bigint, no: bigint): number =>
  Math.round(usdcFromBase(yes + no) * 100) / 100;

export interface VaultPoolProjection {
  readonly settledYes: bigint;
  readonly settledNo: bigint;
  readonly liveYes: bigint;
  readonly liveNo: bigint;
}

/** Settled on-chain pools plus board-replayed live pools (agent-3 `livePoolUSDC` semantics). */
export const projectVaultPools = (
  vault: OptionsVault,
  snapshot: OptionsVaultSnapshot | undefined,
  atMs: number
): VaultPoolProjection => {
  const settledYes = vault.pools.yes;
  const settledNo = vault.pools.no;
  const live =
    snapshot?.boards === undefined
      ? vault.pools
      : projectVaultLivePools({
          boards: snapshot.boards,
          pendingBoundaries: snapshot.pendingBoundaries,
          // Cap at the creator-seed runway so the homepage pool stops at what was funded instead of
          // extrapolating forever (the app passes NFT-lane boundaries on top; the host only has the
          // seed, which is the dominant funder for an unbet vault).
          funderBoundaries: snapshot.seedBoundaries,
          atMs,
          resolvedAtMs: vault.timing.resolvedAtMs
        });
  return {
    settledYes,
    settledNo,
    liveYes: live.yes,
    liveNo: live.no
  };
};
