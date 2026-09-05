// --- exports ---

import type { OptionsVaultPools, OptionsVaultShareTotals, OptionsVaultSide } from "../vault.js";
import { priceOf, projectShares } from "./curve.js";

export type OptionsBoardState = {
  readonly pool: bigint;
  readonly sideRate: bigint;
  readonly g: bigint;
  readonly lastAdvanceMs: number;
};

export type OptionsStreamAccrualView = {
  readonly pendingShares: string;
  readonly valueUSDC: string;
  readonly sharesPerSec: string;
  readonly sharePriceNow: string;
};

export type PreviewAccrualInput = {
  readonly vaultId: import("../ids.js").VaultId;
  readonly side: OptionsVaultSide;
  readonly rate: bigint;
  readonly horizonSec?: number;
};

export type OptionsAccrualPreview = {
  readonly sharePriceUSDC: string;
  readonly sharesPerSec: string;
  readonly projectedShares: string;
  readonly valueUSDC: string;
};

export type ProjectAccrualPreviewInput = {
  readonly board: OptionsBoardState;
  readonly pools: OptionsVaultPools;
  readonly shareTotals: OptionsVaultShareTotals;
  readonly side: OptionsVaultSide;
  readonly rate: bigint;
  readonly horizonSec?: number;
  readonly atMs?: number;
  readonly resolvedAtMs?: number;
};

export const projectAccrualPreview = (
  input: ProjectAccrualPreviewInput
): OptionsAccrualPreview => {
  const horizonSec = input.horizonSec ?? 60;
  const atMs = input.atMs ?? Date.now();
  const position = {
    rate: input.rate,
    gPaid: input.board.g,
    depleted: false
  };

  const sharesNow = projectShares({
    board: input.board,
    position,
    atMs,
    resolvedAtMs: input.resolvedAtMs
  });
  const sharesHorizon = projectShares({
    board: input.board,
    position,
    atMs: atMs + horizonSec * 1000,
    resolvedAtMs: input.resolvedAtMs
  });
  const projectedShares = sharesHorizon > sharesNow ? sharesHorizon - sharesNow : 0n;

  const sharesPerSec =
    input.rate === 0n || input.board.sideRate === 0n
      ? 0n
      : estimateSharesPerSec(input.board, position, atMs, input.resolvedAtMs);

  const totalPool = input.pools.yes + input.pools.no;
  const sideShareTotal =
    input.side === "yes" ? input.shareTotals.yes : input.shareTotals.no;
  const valueUSDC =
    sideShareTotal > 0n ? (projectedShares * totalPool) / sideShareTotal : 0n;

  return {
    sharePriceUSDC: priceOf(input.board.pool).toString(),
    sharesPerSec: sharesPerSec.toString(),
    projectedShares: projectedShares.toString(),
    valueUSDC: valueUSDC.toString()
  };
};

export type ProjectStreamAccrualInput = {
  readonly board: OptionsBoardState;
  readonly position: {
    readonly rate: bigint;
    readonly gPaid: bigint;
    readonly maxEndMs?: number;
    readonly depleted: boolean;
  };
  readonly pendingShares: bigint;
  readonly pools: OptionsVaultPools;
  readonly shareTotals: OptionsVaultShareTotals;
  readonly side: OptionsVaultSide;
  readonly atMs: number;
  readonly resolvedAtMs?: number;
};

export const isAccrualFrozen = (input: ProjectStreamAccrualInput): boolean => {
  const { position, atMs, resolvedAtMs } = input;

  if (position.depleted) {
    return true;
  }

  if (resolvedAtMs !== undefined && atMs >= resolvedAtMs) {
    return true;
  }

  if (position.maxEndMs !== undefined && atMs >= position.maxEndMs) {
    return true;
  }

  return false;
};

export const projectStreamAccrual = (
  input: ProjectStreamAccrualInput
): OptionsStreamAccrualView => {
  const frozen = isAccrualFrozen(input);
  const projectedShares = frozen
    ? input.pendingShares
    : projectShares({
        board: input.board,
        position: input.position,
        atMs: input.atMs,
        resolvedAtMs: input.resolvedAtMs
      });

  const totalPool = input.pools.yes + input.pools.no;
  const sideShareTotal =
    input.side === "yes" ? input.shareTotals.yes : input.shareTotals.no;
  const valueUSDC =
    sideShareTotal > 0n ? (projectedShares * totalPool) / sideShareTotal : 0n;

  const sharePriceNow = priceOf(input.board.pool);
  const sharesPerSec = frozen
    ? 0n
    : estimateSharesPerSec(input.board, input.position, input.atMs, input.resolvedAtMs);

  return {
    pendingShares: projectedShares.toString(),
    valueUSDC: valueUSDC.toString(),
    sharesPerSec: sharesPerSec.toString(),
    sharePriceNow: sharePriceNow.toString()
  };
};

// --- helpers ---

const estimateSharesPerSec = (
  board: OptionsBoardState,
  position: ProjectStreamAccrualInput["position"],
  atMs: number,
  resolvedAtMs?: number
): bigint => {
  if (position.rate === 0n || board.sideRate === 0n) {
    return 0n;
  }

  const now = projectShares({ board, position, atMs, resolvedAtMs });
  const next = projectShares({
    board,
    position,
    atMs: atMs + 1000,
    resolvedAtMs
  });

  return next > now ? next - now : 0n;
};
