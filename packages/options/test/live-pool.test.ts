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

  it("caps a forward projection at a funder boundary even when pendingBoundaries is 0", () => {
    // The seed's runway elapsed in WALL-CLOCK, but the chain hasn't mined a block to settle the
    // boundary (pendingBoundaries still 0 — exactly the idle-anvil / live-projection case). The pool
    // must stop at what was funded, not extrapolate the seed rate forever. Before the gate fix this
    // took the uncapped path and climbed to 600_000_000 (the "pool exceeds deposits" bug).
    const lastAdvanceMs = 1_700_000_000_000;
    const seedMaxEndMs = lastAdvanceMs + 30_000; // seed runs dry 30s in
    const atMs = lastAdvanceMs + 600_000; // ...we project 10 minutes later
    const board = { pool: 0n, sideRate: 1_000_000n, g: 0n, lastAdvanceMs };

    const capped = projectLivePoolSide({
      board,
      atMs,
      pendingBoundaries: 0n,
      funderBoundaries: [{ maxEndMs: seedMaxEndMs, rate: 1_000_000n }]
    });

    expect(capped).toBe(30_000_000n); // 1_000_000/s × 30s — full deposit, not 600_000_000
  });

  it("clamps side rate at zero when a boundary rate exceeds the board rate", () => {
    // A boundary's rate can over-count the board rate (e.g. a stale committed rate). Subtracting it
    // must floor at 0, never drive sideRate negative and shrink the pool below what already streamed.
    const lastAdvanceMs = 1_700_000_000_000;
    const board = { pool: 0n, sideRate: 1_000_000n, g: 0n, lastAdvanceMs };

    const capped = projectLivePoolSide({
      board,
      atMs: lastAdvanceMs + 600_000,
      funderBoundaries: [{ maxEndMs: lastAdvanceMs + 30_000, rate: 1_500_000n }]
    });

    expect(capped).toBe(30_000_000n); // 30s × 1_000_000/s, then frozen — not negative
  });
});
