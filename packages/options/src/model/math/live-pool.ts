// --- exports ---

import type { OptionsBoardState } from "./accrual.js";
import { segMath } from "./curve.js";
import type { OptionsVaultPools } from "../vault.js";

export type FunderBoundary = {
  readonly maxEndMs: number;
  readonly rate: bigint;
};

export type ProjectLivePoolSideInput = {
  readonly board: OptionsBoardState;
  readonly atMs?: number;
  readonly resolvedAtMs?: number;
  readonly pendingBoundaries?: bigint;
  readonly funderBoundaries?: readonly FunderBoundary[];
};

export type ProjectVaultLivePoolsInput = {
  readonly boards: {
    readonly yes: OptionsBoardState;
    readonly no: OptionsBoardState;
  };
  readonly atMs?: number;
  readonly resolvedAtMs?: number;
  readonly pendingBoundaries?: {
    readonly yes?: bigint;
    readonly no?: bigint;
  };
  readonly funderBoundaries?: {
    readonly yes?: readonly FunderBoundary[];
    readonly no?: readonly FunderBoundary[];
  };
};

export const projectLivePoolSide = (input: ProjectLivePoolSideInput): bigint => {
  const atMs = input.atMs ?? Date.now();
  const freezeMs = Math.min(atMs, input.resolvedAtMs ?? atMs);
  const { board } = input;

  if (board.lastAdvanceMs === 0 || board.sideRate === 0n) {
    return board.pool;
  }

  if (freezeMs <= board.lastAdvanceMs) {
    return board.pool;
  }

  const pending = input.pendingBoundaries ?? 0n;
  const boundaries = input.funderBoundaries;

  if (pending === 0n || boundaries === undefined || boundaries.length === 0) {
    const dtSeconds = Math.floor((freezeMs - board.lastAdvanceMs) / 1000);
    return segMath({ pool: board.pool, sideRate: board.sideRate, dtSeconds }).newPool;
  }

  return projectLivePoolWithBoundaries(board, freezeMs, boundaries);
};

export const projectVaultLivePools = (
  input: ProjectVaultLivePoolsInput
): OptionsVaultPools => ({
  yes: projectLivePoolSide({
    board: input.boards.yes,
    atMs: input.atMs,
    resolvedAtMs: input.resolvedAtMs,
    pendingBoundaries: input.pendingBoundaries?.yes,
    funderBoundaries: input.funderBoundaries?.yes
  }),
  no: projectLivePoolSide({
    board: input.boards.no,
    atMs: input.atMs,
    resolvedAtMs: input.resolvedAtMs,
    pendingBoundaries: input.pendingBoundaries?.no,
    funderBoundaries: input.funderBoundaries?.no
  })
});

// --- helpers ---

const projectLivePoolWithBoundaries = (
  board: OptionsBoardState,
  freezeMs: number,
  boundaries: readonly FunderBoundary[]
): bigint => {
  let pool = board.pool;
  let sideRate = board.sideRate;
  let tMs = board.lastAdvanceMs;
  const atSec = Math.floor(freezeMs / 1000);

  const sorted = [...boundaries]
    .filter((entry) => entry.rate > 0n)
    .sort((left, right) => left.maxEndMs - right.maxEndMs);

  for (const boundary of sorted) {
    const boundarySec = Math.floor(boundary.maxEndMs / 1000);
    if (boundarySec > atSec) {
      break;
    }

    const tSec = Math.floor(tMs / 1000);
    if (boundarySec > tSec && sideRate !== 0n) {
      pool = segMath({
        pool,
        sideRate,
        dtSeconds: boundarySec - tSec
      }).newPool;
      sideRate -= boundary.rate;
      tMs = boundary.maxEndMs;
    }
  }

  const tSec = Math.floor(tMs / 1000);
  if (sideRate !== 0n && atSec > tSec) {
    pool = segMath({ pool, sideRate, dtSeconds: atSec - tSec }).newPool;
  }

  return pool;
};
