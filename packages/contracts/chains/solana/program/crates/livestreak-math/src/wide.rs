//! Wide-by-default arithmetic layer (doctrine: context/solana-port-strategy.md §5).
//!
//! ALL engine math runs in 256-bit — semantics identical to the Move u256 sources by
//! construction, so a "missed widening site" cannot exist. u128 is the storage format
//! only; the ONLY way back down is `narrow()`, which aborts at a named boundary.

pub use ethnum::I256;
pub use ruint::aliases::U256;

/// Promote a stored value into wide math.
#[inline]
pub fn w(x: u128) -> U256 {
    U256::from(x)
}

/// The single storage boundary: aborts (on-chain: program error) if a computed value
/// no longer fits its u128 storage slot. Never used mid-expression.
#[inline]
pub fn narrow(x: U256, what: &str) -> u128 {
    assert!(x <= U256::from(u128::MAX), "narrow overflow: {}", what);
    x.to::<u128>()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_product_past_u128_narrows_after_division() {
        // The audit's poison case: rate 1e12 * gDelta 1e30 = 1e42 — impossible in u128,
        // exact in U256; fits storage again after /WAD.
        let wad = w(10u128.pow(18));
        let shares = w(10u128.pow(12)) * w(10u128.pow(30)) / wad;
        assert_eq!(narrow(shares, "shares"), 10u128.pow(24));
    }

    #[test]
    #[should_panic(expected = "narrow overflow")]
    fn narrow_aborts_loudly() {
        narrow(U256::from(u128::MAX) + U256::from(1u8), "test");
    }
}
