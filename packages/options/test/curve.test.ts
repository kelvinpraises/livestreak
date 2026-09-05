import { describe, expect, it } from "vitest";

import { BASE_PRICE, CURVE_K, projectShares, segMath, SHARE_SCALE, WAD } from "../src/model/math/curve.js";

describe("bonding curve", () => {
  it("priceOf returns base price at zero pool", async () => {
    const { priceOf } = await import("../src/model/math/curve.js");
    expect(priceOf(0n)).toBe(BASE_PRICE);
  });

  it("priceOf scales linearly with pool over CURVE_K", async () => {
    const { priceOf } = await import("../src/model/math/curve.js");
    expect(priceOf(CURVE_K)).toBe(BASE_PRICE * 2n);
    expect(priceOf(CURVE_K * 2n)).toBe(BASE_PRICE * 3n);
  });

  it("sharesPerUsdc inverts price at SHARE_SCALE", async () => {
    const { priceOf, sharesPerUsdc } = await import("../src/model/math/curve.js");
    const pool = 100_000_000n;
    const price = priceOf(pool);

    expect(sharesPerUsdc(pool)).toBe(SHARE_SCALE / price);
  });

  it("sharesPerUsdc at zero pool uses base price", async () => {
    const { priceOf, sharesPerUsdc } = await import("../src/model/math/curve.js");
    expect(sharesPerUsdc(0n)).toBe(SHARE_SCALE / BASE_PRICE);
  });

  it("segMath matches hand-computed dG for a sample segment", () => {
    const pool = 50_000_000n;
    const sideRate = 1_000_000n;
    const dtSeconds = 30;

    const { dG, newPool } = segMath({ pool, sideRate, dtSeconds });
    const p0 = Number(BASE_PRICE + (BASE_PRICE * pool) / CURVE_K);
    const p1 = Number(BASE_PRICE + (BASE_PRICE * newPool) / CURVE_K);
    // dG is now WAD-scaled (×1e18) to match the on-chain g units.
    const expectedDG = BigInt(
      Math.floor(
        ((Number(SHARE_SCALE) * Number(CURVE_K) * Math.log(p1 / p0)) /
          (Number(BASE_PRICE) * Number(sideRate))) *
          1e18
      )
    );

    expect(newPool).toBe(pool + sideRate * BigInt(dtSeconds));
    expect(dG).toBe(expectedDG);
  });

  it("credits the on-chain share-units for a live streamed segment ($1/s, $5k pool, 60s)", () => {
    // Funds-at-risk regression: before the WAD fix this credited 0 share-units. The contract credits
    // ~399,202,126 share-units for $1/s streamed for 60s into a $5,000 pool (all values at 6 dp).
    const lastAdvanceMs = 1_700_000_000_000;
    const board = {
      pool: 5_000_000_000n, // 5,000 USDC
      sideRate: 1_000_000n, // 1 USDC/s on this side
      g: 0n,
      lastAdvanceMs
    };
    const position = { rate: 1_000_000n, gPaid: 0n, depleted: false };

    const shares = projectShares({ board, position, atMs: lastAdvanceMs + 60_000 });

    expect(shares).toBe(399_202_126n);
    expect(shares).toBeGreaterThan(0n); // the bug returned 0n
  });

  it("projectShares advances g over elapsed time", () => {
    const lastAdvanceMs = 1_700_000_000_000;
    const atMs = lastAdvanceMs + 10_000;
    const board = {
      pool: 10_000_000n,
      sideRate: 500_000n,
      g: 1_000_000_000_000_000_000n,
      lastAdvanceMs
    };
    const position = {
      rate: 100_000n,
      gPaid: 500_000_000_000_000_000n,
      depleted: false
    };

    const shares = projectShares({ board, position, atMs });
    const { dG } = segMath({ pool: board.pool, sideRate: board.sideRate, dtSeconds: 10 });
    const expected = (position.rate * (board.g + dG - position.gPaid)) / WAD;

    expect(shares).toBe(expected);
  });

  it("projectShares freezes when depleted", () => {
    const board = {
      pool: 10_000_000n,
      sideRate: 500_000n,
      g: 2_000_000_000_000_000_000n,
      lastAdvanceMs: 1_700_000_000_000
    };

    expect(
      projectShares({
        board,
        position: { rate: 100_000n, gPaid: 0n, depleted: true },
        atMs: board.lastAdvanceMs + 60_000
      })
    ).toBe(0n);
  });
});
