// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MarketDriver} from "../../solidity/streaming/drivers/MarketDriver.sol";
import {Side} from "../../solidity/vault/Side.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {Vm} from "forge-std/Vm.sol";

/// @dev Shared mint/fund helpers for MarketDriver tests.
library MarketDriverHarness {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function mint(MarketDriver driver, address who, bytes32 marketId) internal returns (uint256 tokenId) {
        vm.prank(who);
        tokenId = driver.mint(marketId, who);
    }

    function fund(
        MarketDriver driver,
        MockUSDC usdc,
        address who,
        uint256 tokenId,
        bytes32 vaultId,
        Side side,
        uint256 rate,
        uint256 deposit
    ) internal {
        usdc.mint(who, deposit);
        vm.startPrank(who);
        usdc.approve(address(driver), deposit);
        driver.fund(tokenId, vaultId, side, rate, deposit);
        vm.stopPrank();
    }
}
