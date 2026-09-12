import { describe, expect, it } from "vitest";

import { mapLane, type RawLane, type RawPosition } from "../src/chains/evm/decode.js";
import { WAD } from "../src/model/math/curve.js";
import { sharesToNumber } from "../src/model/units.js";
import { asTokenId } from "../src/model/ids.js";

// The contract stores per-position `sharesAccrued` at WAD·SCALE (1e24) for accumulator precision, but
// exposes the per-SIDE totals already ÷WAD (SHARE_SCALE, 1e6). Decode must ÷WAD so the model speaks ONE
// share unit — otherwise per-lane shares read ~1e18× too large and percentOfSide (shares ÷ sideTotal)
// inflates by 1e18. This guards that boundary normalization on the real EVM decode (the fake chain
// bypasses decode and so never exercised it).
describe("evm mapLane — share-scale normalization (÷WAD)", () => {
  const tokenId = asTokenId(7n);
  const lane: RawLane = { vaultId: `0x${"ab".repeat(32)}`, side: 0, rate: 50_000n };

  it("normalizes WAD·SCALE sharesAccrued to canonical SHARE_SCALE", () => {
    const position: RawPosition = {
      rate: 50_000n,
      gPaid: 0n,
      sharesAccrued: 95_884_945n * WAD, // 95.884945 shares stored at WAD·SCALE
      maxEnd: 0,
      depleted: false
    };
    const mapped = mapLane(tokenId, lane, position);
    expect(mapped.sharesAccrued).toBe(95_884_945n); // SHARE_SCALE, NOT 95_884_945n * WAD
    expect(sharesToNumber(mapped.sharesAccrued)).toBeCloseTo(95.884945, 6);
  });

  it("floors sub-SHARE_SCALE dust, matching getPools' integer ÷WAD", () => {
    const position: RawPosition = {
      rate: 1n,
      gPaid: 0n,
      sharesAccrued: WAD - 1n, // < 1 SHARE_SCALE unit of accrued precision
      maxEnd: 0,
      depleted: false
    };
    expect(mapLane(tokenId, lane, position).sharesAccrued).toBe(0n);
  });
});
