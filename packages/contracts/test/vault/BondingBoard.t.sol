// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {BondingBoard} from "../../src/vault/BondingBoard.sol";

/// @notice Pure curve + Board-step properties (replaces the old eager-creditPosition curve tests).
contract BondingBoardTest is Test {
    function test_priceIsBaseAtEmptyPool() public {
        assertEq(BondingBoard.price(0), 100_000);
    }

    function test_priceRisesWithPool() public {
        assertGt(BondingBoard.price(1e6), BondingBoard.price(0));
        assertGt(BondingBoard.price(10_000e6), BondingBoard.price(1e6));
    }

    function test_priceDoublesAtCurveK() public {
        assertEq(BondingBoard.price(10_000e6), 200_000); // base·(1 + 1)
    }

    /// Single funder ($1/sec, 50s into an empty side) → ~498.75 shares; the curve crept up.
    function test_segMath_workedExample() public {
        (uint256 newPool, uint256 dG) = BondingBoard.segMath(0, 1_000_000, 50);
        assertEq(newPool, 50_000_000, "pool after 50s");
        uint256 shares = (1_000_000 * dG) / 1e18; // single funder: rate == sideRate
        assertApproxEqAbs(shares, 498_750_000, 100_000, "~498.75 shares");
        assertLt(shares, 500_000_000, "strictly under 500");
    }

    /// Monotonic: the same stretch at a higher pool earns fewer shares (price is higher).
    function test_segMath_higherPoolFewerShares() public {
        (, uint256 dGLow) = BondingBoard.segMath(0, 1_000_000, 50);
        (, uint256 dGHigh) = BondingBoard.segMath(10_000e6, 1_000_000, 50);
        assertLt(dGHigh, dGLow);
    }

    function test_segMath_flatStretchEarnsNothing() public {
        (uint256 newPool, uint256 dG) = BondingBoard.segMath(1_000_000, 1_000_000, 0);
        assertEq(newPool, 1_000_000);
        assertEq(dG, 0);
    }
}
