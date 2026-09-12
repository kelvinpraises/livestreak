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

  const boundaries = input.funderBoundaries;

  // Cap at funder depletion whenever ANY boundary is known — judged against `freezeMs` (wall-clock),
  // NOT the on-chain `pendingBoundaries` count. A live projection runs ahead of block time, so a
  // funder whose runway has elapsed in wall-clock must drop out even though the chain hasn't settled
  // its boundary yet; gating on the on-chain count let the seed rate extrapolate forever past its
  // run-dry instant (the "pool climbs past what was funded" bug). The boundary walk no-ops on
  // still-future boundaries, so this stays exact while the funder is live.
  if (boundaries === undefined || boundaries.length === 0) {
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
