// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";

/// @title BondingBoard — pure bonding-curve + Board-step math for streamed funding.
///
/// @notice Stateless helpers shared by the Vault's funding Board. `price` is the share price on the
/// curve `BASE_PRICE·(1 + pool/CURVE_K)`. `segMath` advances the Board over one constant-rate stretch
/// in closed form: the exact area under the shares-per-dollar curve, computed with a single `lnWad`
/// instead of iterating cycle by cycle.
///
/// Share-accounting convention (proven by test/vault/VaultBoard.t.sol): the Board index `g` is
/// WAD-scaled shares-per-unit-rate; a funder's shares (SHARE_SCALE units) are `rate·(g − gPaid)/1e18`.
library BondingBoard {
    uint256 internal constant BASE_PRICE = 100_000; // 1e5
    uint256 internal constant CURVE_K = 10_000e6; // 1e10
    uint256 internal constant SHARE_SCALE = 1e6; // 1e6
    uint256 internal constant WAD = 1e18;

    /// @notice Share price for a side holding `pool` USDC (6-dec units).
    function price(uint256 pool) internal pure returns (uint256) {
        return BASE_PRICE + (BASE_PRICE * pool) / CURVE_K;
    }

    /// @notice One Board step over a constant-rate stretch of `dt` seconds.
    /// @param pool side pool before the stretch
    /// @param sideRate sum of active funder rates (USDC-units/sec); must be > 0
    /// @param dt stretch length in seconds
    /// @return newPool pool after `sideRate·dt` flows in
    /// @return dG WAD increase of the shares-per-unit-rate index `g`
    function segMath(uint256 pool, uint256 sideRate, uint256 dt) internal pure returns (uint256 newPool, uint256 dG) {
        uint256 p0 = price(pool);
        newPool = pool + sideRate * dt;
        uint256 p1 = price(newPool);
        if (p1 == p0) return (newPool, 0);
        uint256 ratioWad = (p1 * WAD) / p0;
        int256 lnv = FixedPointMathLib.lnWad(int256(ratioWad)); // >= 0 since p1 >= p0
        // ΔG = SHARE_SCALE·CURVE_K·ln(p1/p0) / (BASE_PRICE·sideRate), WAD-scaled
        dG = (SHARE_SCALE * CURVE_K * uint256(lnv)) / (BASE_PRICE * sideRate);
    }
}
