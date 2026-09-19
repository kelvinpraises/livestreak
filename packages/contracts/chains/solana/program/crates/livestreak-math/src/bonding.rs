//! Bonding curve, transliterated 1:1 from `chains/sui/sources/vault/bonding_board.move`.
//! Every expression computes in U256 (wide-by-default doctrine) — semantics identical to
//! the Move u256 source by construction. u128 appears only at the storage boundary.

use crate::ln::ln_e9;
use crate::wide::{narrow, w};

pub const BASE_PRICE: u128 = 100_000;
pub const CURVE_K: u128 = 10_000_000_000;
pub const SHARE_SCALE: u128 = 1_000_000;
pub const WAD: u128 = 1_000_000_000_000_000_000;
const UD30X9_SCALE: u128 = 1_000_000_000;

/// price(pool) = BASE_PRICE + BASE_PRICE * pool / CURVE_K
pub fn price(pool: u128) -> u128 {
    narrow(w(BASE_PRICE) + w(BASE_PRICE) * w(pool) / w(CURVE_K), "price")
}

/// One curve segment: pool grows by side_rate*dt; dG (WAD-scaled share-accumulator
/// increment) = SHARE_SCALE * CURVE_K * ln(p1/p0) / (BASE_PRICE * side_rate).
/// Returns (new_pool, d_g).
pub fn seg_math(pool: u128, side_rate: u128, dt: u128) -> (u128, u128) {
    let p0 = w(price(pool));
    let new_pool = w(pool) + w(side_rate) * w(dt);
    let p1 = w(price(narrow(new_pool, "pool")));

    if p1 == p0 {
        return (narrow(new_pool, "pool"), 0);
    }

    let ratio = narrow(p1 * w(UD30X9_SCALE) / p0, "price ratio");
    let lnv = w(ln_e9(ratio)) * w(UD30X9_SCALE);
    let d_g = w(SHARE_SCALE) * w(CURVE_K) * lnv / (w(BASE_PRICE) * w(side_rate));

    (narrow(new_pool, "pool"), narrow(d_g, "dG"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // EVM goldens (solady lnWad) — the SAME vectors bonding_board.move pins, same tolerance:
    // OZ ln is 1e9-scaled vs WAD 1e18; residual ≤ ~1e3 share units.
    const SHARES_TOLERANCE: u128 = 1_000;

    fn abs_diff(a: u128, b: u128) -> u128 {
        if a >= b { a - b } else { b - a }
    }

    fn dg_tolerance() -> u128 {
        SHARES_TOLERANCE * WAD / 1_000_000
    }

    #[test]
    fn price_empty() {
        assert_eq!(price(0), 100_000);
    }

    #[test]
    fn price_doubles_at_curve_k() {
        assert_eq!(price(10_000_000_000), 200_000);
    }

    /// EVM golden: pool=0, rate=1e6, dt=50 → shares=498754151, d_g=498754151103907300000.
    #[test]
    fn seg_math_worked_example_evm_parity() {
        let (new_pool, d_g) = seg_math(0, 1_000_000, 50);
        assert_eq!(new_pool, 50_000_000);
        let shares = narrow(w(1_000_000u128) * w(d_g) / w(WAD), "shares");
        assert!(abs_diff(shares, 498_754_151) <= SHARES_TOLERANCE, "shares {shares}");
        assert!(
            abs_diff(d_g, 498_754_151_103_907_300_000) <= dg_tolerance(),
            "d_g {d_g}"
        );
        assert!(shares < 500_000_000);
    }

    /// EVM golden: pool=1e6, rate=1e6, dt=50 → d_g=498704404822379600000, shares=498704404.
    #[test]
    fn seg_math_evm_parity_mid_pool() {
        let (new_pool, d_g) = seg_math(1_000_000, 1_000_000, 50);
        assert_eq!(new_pool, 51_000_000);
        let shares = narrow(w(1_000_000u128) * w(d_g) / w(WAD), "shares");
        assert!(abs_diff(shares, 498_704_404) <= SHARES_TOLERANCE, "shares {shares}");
        assert!(
            abs_diff(d_g, 498_704_404_822_379_600_000) <= dg_tolerance(),
            "d_g {d_g}"
        );
    }

    /// EVM golden: pool=1e10, rate=1e6, dt=50 → d_g=249688019858719800000, shares=249688019.
    #[test]
    fn seg_math_evm_parity_high_pool() {
        let (new_pool, d_g) = seg_math(10_000_000_000, 1_000_000, 50);
        assert_eq!(new_pool, 10_050_000_000);
        let shares = narrow(w(1_000_000u128) * w(d_g) / w(WAD), "shares");
        assert!(abs_diff(shares, 249_688_019) <= SHARES_TOLERANCE, "shares {shares}");
        assert!(
            abs_diff(d_g, 249_688_019_858_719_800_000) <= dg_tolerance(),
            "d_g {d_g}"
        );
    }

    #[test]
    fn higher_pool_fewer_shares() {
        let (_, d_g_low) = seg_math(0, 1_000_000, 50);
        let (_, d_g_high) = seg_math(10_000_000_000, 1_000_000, 50);
        assert!(d_g_high < d_g_low);
    }

    #[test]
    fn flat_stretch_zero_dg() {
        let (new_pool, d_g) = seg_math(1_000_000, 1_000_000, 0);
        assert_eq!(new_pool, 1_000_000);
        assert_eq!(d_g, 0);
    }

    /// Wide-by-default proof: a pool/rate combination whose dG numerator exceeds u128
    /// still computes exactly (SHARE_SCALE*CURVE_K*lnv ≈ 9e35 is fine; push further with
    /// a tiny rate where rate×gDelta-style products would have overflowed narrow math).
    #[test]
    fn extreme_segment_does_not_overflow() {
        // Rate at the practical minimum, a year-long segment on a large pool.
        let (_, d_g) = seg_math(1_000_000_000_000, 1_000, 31_536_000);
        assert!(d_g > 0);
    }
}
