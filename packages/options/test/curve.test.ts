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
    const expected =
      (Number(SHARE_SCALE) * Number(CURVE_K) * Math.log(p1 / p0)) /
      (Number(BASE_PRICE) * Number(sideRate));

    expect(newPool).toBe(pool + sideRate * BigInt(dtSeconds));
    expect(dG).toBeCloseTo(expected, 6);
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
    const expected = (position.rate * (board.g + BigInt(Math.floor(dG)) - position.gPaid)) / WAD;

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
