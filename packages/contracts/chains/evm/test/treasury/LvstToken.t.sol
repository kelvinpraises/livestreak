// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {LvstToken} from "../../solidity/treasury/LvstToken.sol";
import {Treasury} from "../../solidity/treasury/Treasury.sol";
import {Protocol} from "../../solidity/Protocol.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

contract LvstTokenTest is Test {
    Protocol internal protocol;
    LvstToken internal lvst;
    Treasury internal treasury;
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        MockUSDC usdc = new MockUSDC();
        protocol = new Protocol(address(this));
        lvst = new LvstToken(protocol);
        treasury = new Treasury(address(this), usdc, protocol);
        protocol.setLvstToken(address(lvst));
        protocol.setTreasury(address(treasury));
    }

    function test_erc20Metadata() public view {
        assertEq(lvst.name(), "LiveStreak");
        assertEq(lvst.symbol(), "LVST");
    }

    function test_mintGate_treasuryOnly() public {
        vm.prank(stranger);
        vm.expectRevert("LvstToken: not treasury");
        lvst.mint(stranger, 1e18);

        vm.prank(address(treasury));
        lvst.mint(stranger, 1e18);
        assertEq(lvst.balanceOf(stranger), 1e18);
    }
}
