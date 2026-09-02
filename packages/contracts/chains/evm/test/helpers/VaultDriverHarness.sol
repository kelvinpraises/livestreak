// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VaultDriver} from "../../solidity/streaming/drivers/VaultDriver.sol";
import {Side} from "../../solidity/vault/Side.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {Vm} from "forge-std/Vm.sol";

/// @dev Shared vault creation helpers for VaultDriver tests.
library VaultDriverHarness {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant SEED_CREATOR = address(uint160(uint256(keccak256("vault.seed.creator"))));

    uint256 internal constant MIN_BOND_RATE = 1;
    uint256 internal constant MIN_BOND_DEPOSIT = 1;

    function bondVault(VaultDriver driver, MockUSDC usdc, bytes32 marketId, string memory question, Side seedSide)
        internal
        returns (bytes32 vaultId)
    {
        vaultId = createVault(driver, usdc, SEED_CREATOR, marketId, question, seedSide, MIN_BOND_RATE, MIN_BOND_DEPOSIT);
        vm.prank(SEED_CREATOR);
        driver.stopSeed(vaultId);
        driver.harvest(vaultId, seedSide);
    }

    function createVault(
        VaultDriver driver,
        MockUSDC usdc,
        address who,
        bytes32 marketId,
        string memory question,
        Side seedSide,
        uint256 rate,
        uint256 deposit
    ) internal returns (bytes32 vaultId) {
        usdc.mint(who, deposit);
        vm.startPrank(who);
        usdc.approve(address(driver), deposit);
        vaultId = driver.createVault(marketId, question, seedSide, rate, deposit);
        vm.stopPrank();
    }
}
