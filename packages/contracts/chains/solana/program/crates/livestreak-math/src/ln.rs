//! Natural-log kernel, ported 1:1 from OZ contracts-sui `openzeppelin_fp_math` rev v1.3.0
//! (`ud30x9_base::ln` / `common::raw_log2`) — the exact implementation the Sui leg runs,
//! so the solady↔OZ golden-parity tolerances carry over to this chain unchanged.
//!
//! Kernel-internal math stays u128 like the source: every step carries the SOURCE's own
//! documented invariant (the squaring loop keeps `y < 2e18`, so `y*y < 4e36 < 2^128`),
//! and the golden tests below pin the outputs. The wide-by-default doctrine applies at
//! the CALL sites (bonding.rs), which consume this kernel through U256 expressions.

use crate::wide::{narrow, w};

/// User-facing fixed-point scale (1e9), matching UD30x9.
pub const SCALE_E9: u128 = 1_000_000_000;

/// Internal iteration scale (1e18) — an order of magnitude finer than the user scale;
/// the source documents total frac error < ~1e3 at 1e18, below one 1e9-ulp.
const INTERNAL_LOG_SCALE: u128 = 1_000_000_000_000_000_000;

/// floor(ln(2) * 1e18).
const LN2_E18: u128 = 693_147_180_559_945_309;

/// Two 1e18 scale factors land at 1e36; /1e27 returns to the 1e9 user scale.
const LOG_FACTOR_DENOM_E27: u128 = 1_000_000_000_000_000_000_000_000_000;

/// ln of a 1e9-scaled input, 1e9-scaled result. Aborts for inputs < 1.0 (result would be
/// negative/unrepresentable) — matching the source precondition; the bonding curve only
/// calls this with price ratios ≥ 1.
pub fn ln_e9(x_e9: u128) -> u128 {
    assert!(x_e9 >= SCALE_E9, "ln input < 1.0");
    let (_, mag) = raw_log2(x_e9);
    // log2 magnitude ≤ 128e18 (< 2^67) × ln2e18 (< 2^60): computed wide per doctrine.
    narrow(w(mag) * w(LN2_E18) / w(LOG_FACTOR_DENOM_E27), "ln")
}

/// Binary-fraction log2: returns (negative, magnitude at 1e18 scale).
fn raw_log2(x_raw: u128) -> (bool, u128) {
    assert!(x_raw > 0, "log of zero");

    let scale = SCALE_E9;
    let internal = INTERNAL_LOG_SCALE;

    // Normalize so the real value is in [1, 2), tracking the signed integer part of log2.
    let (neg, n_abs, y_at_scale): (bool, u32, u128) = if x_raw >= scale {
        let n = floor_log2(x_raw / scale);
        (false, n, x_raw >> n)
    } else {
        // Sub-1 inputs: msb gap can under-estimate the shift by one; the explicit
        // `< scale` check repairs it (source comment carried verbatim).
        let mut shift = msb(scale) - msb(x_raw);
        let mut shifted = x_raw << shift;
        if shifted < scale {
            shift += 1;
            shifted <<= 1;
        }
        (true, shift, shifted)
    };

    // Lift 1e9 → 1e18 for the iteration. Source invariant: y < 2*internal at every step,
    // so y*y < (2e18)^2 < 2^122 — fits u128 (this is the kernel's own documented proof).
    let mut y: u128 = y_at_scale * scale;
    let internal_x2: u128 = 2 * internal;

    let mut frac: u128 = 0;
    let mut delta: u128 = internal / 2;
    while delta > 0 {
        y = y * y / internal;
        if y >= internal_x2 {
            frac += delta;
            y >>= 1;
        }
        delta >>= 1;
    }

    let n_x_internal = (n_abs as u128) * internal;
    let magnitude = if neg { n_x_internal - frac } else { n_x_internal + frac };
    (neg, magnitude)
}

#[inline]
fn floor_log2(x: u128) -> u32 {
    debug_assert!(x > 0);
    127 - x.leading_zeros()
}

#[inline]
fn msb(x: u128) -> u32 {
    debug_assert!(x > 0);
    127 - x.leading_zeros()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ln_of_one_is_zero() {
        assert_eq!(ln_e9(SCALE_E9), 0);
    }

    #[test]
    fn ln_of_two_is_ln2() {
        // floor(ln(2)*1e9) = 693147180
        let v = ln_e9(2 * SCALE_E9);
        assert!((693_147_179..=693_147_181).contains(&v), "got {v}");
    }

    #[test]
    fn ln_of_e_is_one() {
        // e ≈ 2.718281828 at 1e9 scale → ln ≈ 1e9
        let v = ln_e9(2_718_281_828);
        assert!((999_999_998..=1_000_000_001).contains(&v), "got {v}");
    }

    #[test]
    fn ln_of_curve_worked_ratio() {
        // The bonding worked example's ratio: p1/p0 = 1.005 → ln ≈ 0.004987542 (1e9-scaled).
        let v = ln_e9(1_005_000_000);
        assert!((4_987_540..=4_987_543).contains(&v), "got {v}");
    }

    #[test]
    fn ln_of_large_input() {
        // ln(1e10 at 1e9 scale) = ln(10) ≈ 2.302585093
        let v = ln_e9(10 * SCALE_E9);
        assert!((2_302_585_090..=2_302_585_095).contains(&v), "got {v}");
    }

    #[test]
    #[should_panic(expected = "ln input < 1.0")]
    fn rejects_sub_one_input() {
        ln_e9(SCALE_E9 - 1);
    }
}
