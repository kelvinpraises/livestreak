// SPDX-License-Identifier: GPL-3.0-only

module livestreak::bonding_board;

use openzeppelin_fp_math::ud30x9;
use openzeppelin_fp_math::ud30x9_base;

const BASE_PRICE: u256 = 100_000;
const CURVE_K: u256 = 10_000_000_000;
const SHARE_SCALE: u256 = 1_000_000;
const WAD: u256 = 1_000_000_000_000_000_000;
const UD30X9_SCALE: u256 = 1_000_000_000;

public fun price(pool: u256): u256 {
    BASE_PRICE + (BASE_PRICE * pool) / CURVE_K
}

public fun seg_math(pool: u256, side_rate: u256, dt: u256): (u256, u256) {
    let p0 = price(pool);
    let new_pool = pool + side_rate * dt;
    let p1 = price(new_pool);
    if (p1 == p0) {
        return (new_pool, 0)
    };
    let ratio = ud30x9::wrap((((p1 * UD30X9_SCALE) / p0) as u128));
    let lnv = (ud30x9::unwrap(ud30x9_base::ln(ratio)) as u256) * UD30X9_SCALE;
    let d_g = (SHARE_SCALE * CURVE_K * lnv) / (BASE_PRICE * side_rate);
    (new_pool, d_g)
}

#[test_only]
public fun base_price(): u256 { BASE_PRICE }

public fun wad(): u256 { WAD }

#[test_only]
public fun share_scale(): u256 { SHARE_SCALE }

#[test]
fun test_price_empty() {
    assert!(price(0) == 100_000, 0);
}

#[test]
fun test_price_doubles_at_curve_k() {
    assert!(price(10_000_000_000) == 200_000, 0);
}

/// EVM golden (solady lnWad): pool=0, rate=1e6, dt=50 → shares=498754151, d_g=498754151103907300000.
/// Tolerance bound: OZ UD30x9 ln is 1e9-scaled (vs WAD 1e18); rescale is exact, residual ≤ ~1e3 share units.
const EVM_SHARES_WORKED: u256 = 498_754_151;
const EVM_DG_WORKED: u256 = 498_754_151_103_907_300_000;
const SHARES_TOLERANCE: u256 = 1_000;

#[test]
fun test_seg_math_worked_example_evm_parity() {
    let (new_pool, d_g) = seg_math(0, 1_000_000, 50);
    assert!(new_pool == 50_000_000, 0);
    let shares = (1_000_000 * d_g) / WAD;
    assert!(abs_diff(shares, EVM_SHARES_WORKED) <= SHARES_TOLERANCE, 1);
    assert!(abs_diff(d_g, EVM_DG_WORKED) <= SHARES_TOLERANCE * WAD / 1_000_000, 2);
    assert!(shares < 500_000_000, 3);
}

/// EVM: pool=1_000_000, rate=1e6, dt=50 → d_g=498704404822379600000, shares=498704404.
#[test]
fun test_seg_math_evm_parity_mid_pool() {
    let (new_pool, d_g) = seg_math(1_000_000, 1_000_000, 50);
    assert!(new_pool == 51_000_000, 0);
    let shares = (1_000_000 * d_g) / WAD;
    assert!(abs_diff(shares, 498_704_404) <= SHARES_TOLERANCE, 1);
    assert!(abs_diff(d_g, 498_704_404_822_379_600_000) <= SHARES_TOLERANCE * WAD / 1_000_000, 2);
}

/// EVM: pool=10_000_000_000, rate=1e6, dt=50 → d_g=249688019858719800000, shares=249688019.
#[test]
fun test_seg_math_evm_parity_high_pool() {
    let (new_pool, d_g) = seg_math(10_000_000_000, 1_000_000, 50);
    assert!(new_pool == 10_050_000_000, 0);
    let shares = (1_000_000 * d_g) / WAD;
    assert!(abs_diff(shares, 249_688_019) <= SHARES_TOLERANCE, 1);
    assert!(abs_diff(d_g, 249_688_019_858_719_800_000) <= SHARES_TOLERANCE * WAD / 1_000_000, 2);
}

#[test]
fun test_seg_math_higher_pool_fewer_shares() {
    let (_, d_g_low) = seg_math(0, 1_000_000, 50);
    let (_, d_g_high) = seg_math(10_000_000_000, 1_000_000, 50);
    assert!(d_g_high < d_g_low, 0);
}

#[test]
fun test_seg_math_flat_stretch() {
    let (new_pool, d_g) = seg_math(1_000_000, 1_000_000, 0);
    assert!(new_pool == 1_000_000, 0);
    assert!(d_g == 0, 1);
}

fun abs_diff(a: u256, b: u256): u256 {
    if (a >= b) {
        a - b
    } else {
        b - a
    }
}
