import { describe, expect, it } from "vitest";

import { projectLivePoolSide, projectVaultLivePools, totalVaultPool } from "../src/model/index.js";

describe("projectVaultLivePools", () => {
  it("projects pool from board sideRate over elapsed seconds (6-dec USDC)", () => {
    const lastAdvanceMs = 1_700_000_000_000;
    const atMs = lastAdvanceMs + 30_000;
    const board = {
      pool: 0n,
      sideRate: 1_000_000n,
      g: 0n,
      lastAdvanceMs
    };

    const live = projectLivePoolSide({ board, atMs });

    expect(live).toBe(30_000_000n);
  });

  it("sums yes and no live pools for a vault", () => {
    const lastAdvanceMs = 1_700_000_000_000;
    const atMs = lastAdvanceMs + 30_000;
    const livePools = projectVaultLivePools({
      boards: {
        yes: { pool: 0n, sideRate: 1_000_000n, g: 0n, lastAdvanceMs },
        no: { pool: 10_000_000n, sideRate: 500_000n, g: 0n, lastAdvanceMs }
      },
      atMs
    });

    expect(livePools.yes).toBe(30_000_000n);
    expect(livePools.no).toBe(25_000_000n);
    expect(totalVaultPool(livePools)).toBe(55_000_000n);
  });

  it("walks funder boundaries when pendingBoundaries > 0", () => {
    const lastAdvanceMs = 1_700_000_000_000;
    const atMs = lastAdvanceMs + 60_000;
    const board = {
      pool: 0n,
      sideRate: 2_000_000n,
      g: 0n,
      lastAdvanceMs
    };

    const stretchOnly = projectLivePoolSide({ board, atMs, pendingBoundaries: 0n });
    const withBoundary = projectLivePoolSide({
      board,
      atMs,
      pendingBoundaries: 1n,
      funderBoundaries: [{ maxEndMs: lastAdvanceMs + 30_000, rate: 1_000_000n }]
    });

    expect(stretchOnly).toBe(120_000_000n);
    expect(withBoundary).toBe(90_000_000n);
  });
});
