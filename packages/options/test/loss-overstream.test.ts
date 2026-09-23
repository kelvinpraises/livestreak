import { describe, expect, it } from "vitest";

import {
  computeOverstreamClaimable,
  computeWinClaimable,
  lossBasisToLvst,
  lvstToNumber
} from "../src/model/units.js";
import { enrichLane, mapLane, type RawLane, type RawPosition } from "../src/chains/evm/decode.js";
import { enrichSuiLane } from "../src/chains/sui/decode.js";
import { asTokenId } from "../src/model/ids.js";

// LVST loss-claimable was projected mis-scaled on EVM/Sui (and previously Solana): the vault returns the
// USDC loss BASIS, but the panel scales by the chain's LVST decimals — so the basis rendered ~1e5–1e12×
// too small (live: 0.007 shown where the claim minted 718). The readers now convert basis → LVST with the
// on-chain formula (basis × mintRate / USDC_ONE) so the preview equals the mint. mintRate carries the
// chain's LVST decimals, so the single formula is correct on every chain.
describe("lossBasisToLvst — loss preview equals the on-chain mint", () => {
  const LOSS_BASIS = 7_180_000n; // 7.18 USDC lost (6-dec) — the live scenario

  it("EVM (18-dec LVST): 7.18 USDC × mintRate 100 → 718 whole LVST", () => {
    const mintRate = 100n * 10n ** 18n; // 100 whole LVST per whole USDC, in 18-dec base units
    const lvst = lossBasisToLvst(LOSS_BASIS, mintRate);
    expect(lvst).toBe(718n * 10n ** 18n);
    expect(lvstToNumber(lvst, 18)).toBeCloseTo(718, 6);
  });

  it("Solana/Sui (9-dec LVST): 7.18 USDC × mintRate 100 → 718 whole LVST", () => {
    const mintRate = 100n * 10n ** 9n; // 100 whole LVST per whole USDC, in 9-dec base units
    const lvst = lossBasisToLvst(LOSS_BASIS, mintRate);
    expect(lvst).toBe(718n * 10n ** 9n);
    expect(lvstToNumber(lvst, 9)).toBeCloseTo(718, 6);
  });

  it("the OLD bug: rendering the raw basis as 9-dec LVST gave ~0.007 (regression guard)", () => {
    // Before the fix the reader returned the basis and the projection scaled by 9 → the observed 0.007.
    expect(lvstToNumber(LOSS_BASIS, 9)).toBeCloseTo(0.00718, 6);
    // After: convert first, then scale — 718, not 0.007.
    expect(lvstToNumber(lossBasisToLvst(LOSS_BASIS, 100n * 10n ** 9n), 9)).toBeCloseTo(718, 6);
  });

  it("zero basis → zero LVST", () => {
    expect(lossBasisToLvst(0n, 100n * 10n ** 18n)).toBe(0n);
  });
});

// Overstream = USDC that streamed out of a lane AFTER its vault resolved (committedRate × (min(maxEnd,
// now) − resolvedAt)) — the exact pay_overage entitlement, refundable via withdraw. Was computed only on
// Solana; the shared helper now feeds all three chains.
describe("computeOverstreamClaimable — post-resolution refundable stream", () => {
  const RATE = 10_000n; // 0.60 USDC/min = 0.01 USDC/s = 10_000 base units/s

  it("streams past resolution: rate × (now − resolvedAt)", () => {
    // resolved at t=1000, now=1100, deposit runs to 2000 → 100s of overstream = $1.00
    expect(computeOverstreamClaimable(RATE, 2000, 1000, 1100)).toBe(RATE * 100n);
  });

  it("caps at maxEnd (the deposit ran dry before now)", () => {
    // resolved at 1000, maxEnd 1050, now 1100 → only 50s streamed past resolution
    expect(computeOverstreamClaimable(RATE, 1050, 1000, 1100)).toBe(RATE * 50n);
  });

  it("open vault (resolvedAt 0) → 0", () => {
    expect(computeOverstreamClaimable(RATE, 2000, 0, 1100)).toBe(0n);
  });

  it("deposit ended before resolution → 0 (never overstreamed)", () => {
    expect(computeOverstreamClaimable(RATE, 900, 1000, 1100)).toBe(0n);
  });

  it("no rate → 0", () => {
    expect(computeOverstreamClaimable(0n, 2000, 1000, 1100)).toBe(0n);
  });

  it("no maxEnd cap (maxEnd 0 = uncapped) uses now", () => {
    expect(computeOverstreamClaimable(RATE, 0, 1000, 1100)).toBe(RATE * 100n);
  });
});

// The engine's claimable() view returns 0 until the permissionless `collect` finalizes the pot — so a
// winning position read $0 (and its Cash out button disarmed) until the instant of collection. The reader
// now projects what collect+withdraw will pay, using the same finalize_pot + pay_winnings math, so the win
// shows its real amount and the button arms. pot = winPool + losePool − 2%·losePool; payout = pot × myShare.
describe("computeWinClaimable — projected payout before collect finalizes the pot", () => {
  it("sole winner takes the whole pot (win + lose − 2% skim on the losing pool)", () => {
    // winPool 100, losePool 100 → skim 2 → pot 198; sole winner (mine == side total) gets it all
    expect(computeWinClaimable(100_000_000n, 100_000_000n, 500n, 500n)).toBe(198_000_000n);
  });

  it("splits the pot by the winner's share of the winning side", () => {
    // pot 198; I hold 25% of the winning side (125/500) → 49.5
    expect(computeWinClaimable(100_000_000n, 100_000_000n, 125n, 500n)).toBe(49_500_000n);
  });

  it("skim hits only the losing pool — the winning pool is never skimmed", () => {
    expect(computeWinClaimable(200_000_000n, 0n, 10n, 10n)).toBe(200_000_000n);
  });

  it("no winning shares, or none held → 0", () => {
    expect(computeWinClaimable(100_000_000n, 100_000_000n, 0n, 500n)).toBe(0n);
    expect(computeWinClaimable(100_000_000n, 100_000_000n, 500n, 0n)).toBe(0n);
  });

  it("the live red-card scenario ($119.23 YES / $161.67 NO), sole winner ≈ $277.67 — NOT $0", () => {
    const payout = computeWinClaimable(119_230_000n, 161_670_000n, 1_000n, 1_000n);
    expect(payout).toBe(277_666_600n); // 280.90 − 2% of 161.67
    expect(payout).toBeGreaterThan(0n); // the pre-collect claimable() view would have returned 0 here
  });
});

// The reader enrichers must carry overstreamClaimable through to the lane so the projection can surface
// the settlement-card Overstream row on every chain (undefined when not provided keeps open lanes clean).
describe("enrichLane / enrichSuiLane — overstream passthrough", () => {
  const tokenId = asTokenId(9n);
  const rawLane: RawLane = { vaultId: `0x${"cd".repeat(32)}`, side: 1, rate: 10_000n };
  const position: RawPosition = {
    rate: 10_000n,
    gPaid: 0n,
    sharesAccrued: 0n,
    maxEnd: 2000,
    depleted: false
  };

  it("EVM enrichLane attaches overstreamClaimable when given", () => {
    const lane = enrichLane(mapLane(tokenId, rawLane, position), 0n, 500n, "no", 1_000_000n);
    expect(lane.overstreamClaimable).toBe(1_000_000n);
    expect(lane.lossClaimable).toBe(500n);
  });

  it("EVM enrichLane omits overstreamClaimable when not given (open lane)", () => {
    const lane = enrichLane(mapLane(tokenId, rawLane, position), 0n, 0n, undefined);
    expect(lane.overstreamClaimable).toBeUndefined();
  });

  it("Sui enrichSuiLane attaches overstreamClaimable when given", () => {
    const base = mapLane(tokenId, rawLane, position); // shape-compatible OptionsLane
    const lane = enrichSuiLane(base, 0n, 500n, "no", 2_000_000n);
    expect(lane.overstreamClaimable).toBe(2_000_000n);
  });
});
