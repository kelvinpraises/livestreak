// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Protocol} from "../solidity/Protocol.sol";

contract ProtocolTest is Test {
    address internal owner = makeAddr("owner");
    address internal stranger = makeAddr("stranger");

    Protocol internal protocol;

    function setUp() public {
        protocol = new Protocol(owner);
    }

    function test_setters_onlyOwner() public {
        address addr = makeAddr("module");

        vm.prank(stranger);
        vm.expectRevert();
        protocol.setVault(addr);
    }

    function test_zeroAddress_reverts() public {
        vm.prank(owner);
        vm.expectRevert("Protocol: zero address");
        protocol.setVault(address(0));
    }

    function test_reSet_reverts() public {
        address addr = makeAddr("module");

        vm.startPrank(owner);
        protocol.setVault(addr);
        vm.expectRevert("Protocol: already set");
        protocol.setVault(makeAddr("other"));
        vm.stopPrank();
    }

    function test_getters_returnWhatWasSet() public {
        address market = makeAddr("market");
        address vault = makeAddr("vault");
        address drips = makeAddr("drips");
        address driver = makeAddr("driver");
        address vaultDriver = makeAddr("vaultDriver");
        address steward = makeAddr("steward");
        address lvst = makeAddr("lvst");
        address treasury = makeAddr("treasury");

        vm.startPrank(owner);
        protocol.setMarketRegistry(market);
        protocol.setVault(vault);
        protocol.setDripsStreaming(drips);
        protocol.setMarketDriver(driver);
        protocol.setVaultDriver(vaultDriver);
        protocol.setStewardRegistry(steward);
        protocol.setLvstToken(lvst);
        protocol.setTreasury(treasury);
        vm.stopPrank();

        assertEq(protocol.marketRegistry(), market);
        assertEq(protocol.vault(), vault);
        assertEq(protocol.dripsStreaming(), drips);
        assertEq(protocol.marketDriver(), driver);
        assertEq(protocol.vaultDriver(), vaultDriver);
        assertEq(protocol.stewardRegistry(), steward);
        assertEq(protocol.lvstToken(), lvst);
        assertEq(protocol.treasury(), treasury);
    }
}
