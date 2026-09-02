// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DripsStreaming} from "../../solidity/streaming/DripsStreaming.sol";
import {MarketDriver} from "../../solidity/streaming/drivers/MarketDriver.sol";
import {VaultDriver} from "../../solidity/streaming/drivers/VaultDriver.sol";
import {Vault} from "../../solidity/vault/Vault.sol";
import {Side} from "../../solidity/vault/Side.sol";
import {MarketRegistry} from "../../solidity/registries/MarketRegistry.sol";
import {StewardRegistry} from "../../solidity/steward/StewardRegistry.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {ProtocolWire} from "../helpers/ProtocolWire.sol";
import {MarketDriverHarness} from "../helpers/MarketDriverHarness.sol";
import {VaultDriverHarness} from "../helpers/VaultDriverHarness.sol";

/// @notice Resolution, harvest-on-cycle, unified withdraw, overage, and NFT transfer proofs.
contract VaultResolutionTest is Test {
    uint32 internal constant CYCLE = 10;
    uint256 internal constant START = 100;
    uint256 internal constant RATE = 1_000_000;

    DripsStreaming internal drips;
    MockUSDC internal usdc;
    Vault internal vault;
    VaultDriver internal vaultDriver;
    MarketRegistry internal marketRegistry;
    StewardRegistry internal stewardRegistry;
    MarketDriver internal marketDriver;

    bytes32 internal marketId;
    bytes32 internal v1;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal steward = makeAddr("steward");

    uint256 internal aliceNft;
    uint256 internal bobNft;
    uint256 internal carolNft;

    function setUp() public {
        vm.warp(START);

        usdc = new MockUSDC();
        ProtocolWire.Core memory core = ProtocolWire.deployCore(address(this), IERC20(address(usdc)));
        marketRegistry = core.marketRegistry;
        vault = core.vault;
        stewardRegistry = core.stewardRegistry;

        ProtocolWire.Streaming memory streaming = ProtocolWire.deployStreaming(address(this), vault, usdc, CYCLE);
        streaming = ProtocolWire.wireAll(address(this), core, streaming, false);
        drips = streaming.drips;
        marketDriver = streaming.marketDriver;
        vaultDriver = core.vaultDriver;

        stewardRegistry.registerSteward(steward);
        stewardRegistry.setDefaultSteward(steward);

        marketId = marketRegistry.registerMarket("m", bytes32("s"));
        v1 = VaultDriverHarness.bondVault(vaultDriver, usdc, marketId, "Q?", Side.Yes);

        aliceNft = MarketDriverHarness.mint(marketDriver, alice, marketId);
        bobNft = MarketDriverHarness.mint(marketDriver, bob, marketId);
        carolNft = MarketDriverHarness.mint(marketDriver, carol, marketId);
    }

    function _fund(address who, uint256 tokenId, Side side, uint256 rate, uint256 deposit) internal {
        MarketDriverHarness.fund(marketDriver, usdc, who, tokenId, v1, side, rate, deposit);
    }

    function _resolve(Vault.Outcome outcome) internal {
        vm.prank(steward);
        stewardRegistry.resolveVault(v1, outcome);
    }

    function test_winnerTakesPot() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, Side.No, RATE, 50 * RATE);

        vm.warp(200);
        _resolve(Vault.Outcome.Yes);
        vault.collect(v1);
        assertEq(vault.pot(v1), 100 * RATE, "pot = both pools");

        vm.prank(alice);
        uint256 payout = marketDriver.withdraw(aliceNft, v1, address(0));
        assertEq(payout, 100 * RATE, "sole winner takes all");
        assertEq(usdc.balanceOf(alice), 100 * RATE);
    }

    /// Hedge mid-market via setLanes: alice flips YES->NO; her new side wins and pays, abandoned is a loss.
    function test_setLanes_hedgeNewSideWinsAbandonedLoses() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 50 * RATE);
        vm.warp(120); // accrue 20s on YES, then hedge to NO with the remaining balance
        MarketDriver.Lane[] memory desired = new MarketDriver.Lane[](1);
        desired[0] = MarketDriver.Lane({vaultId: v1, side: Side.No, rate: RATE});
        vm.prank(alice);
        marketDriver.setLanes(aliceNft, desired, 0);
        _fund(bob, bobNft, Side.Yes, RATE, 50 * RATE); // someone now holds the YES alice left

        vm.warp(160);
        _resolve(Vault.Outcome.No); // alice's NEW side wins
        vm.warp(160 + CYCLE * 3); // let cycles complete so harvest banks the cash
        vault.collect(v1);

        vm.prank(alice);
        uint256 payout = marketDriver.withdraw(aliceNft, v1, address(0));
        assertGt(payout, 0, "alice paid on the side she switched to");
        assertGt(vault.lossClaimable(aliceNft, v1, Side.Yes), 0, "abandoned YES is a loss basis");
        assertEq(vault.lossClaimable(aliceNft, v1, Side.No), 0, "winning NO is not a loss");
    }

    /// The owner may direct a withdrawal to any address.
    function test_withdraw_ownerCanRedirectDestination() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(Vault.Outcome.Yes);
        vault.collect(v1);

        address payee = makeAddr("payee");
        vm.prank(alice);
        uint256 paid = marketDriver.withdraw(aliceNft, v1, payee);
        assertGt(paid, 0, "winner paid");
        assertEq(usdc.balanceOf(payee), paid, "winnings went to the chosen address");
        assertEq(usdc.balanceOf(alice), 0, "not the owner's own wallet when redirected");
    }

    /// An approved operator can trigger a payout to the owner but cannot siphon it elsewhere.
    function test_withdraw_operatorCannotRedirectOnlyToOwner() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(Vault.Outcome.Yes);
        vault.collect(v1);

        address operator = makeAddr("operator");
        vm.prank(alice);
        marketDriver.approve(operator, aliceNft);

        address attacker = makeAddr("attacker");
        vm.prank(operator);
        vm.expectRevert("MarketDriver: only owner can redirect");
        marketDriver.withdraw(aliceNft, v1, attacker);

        vm.prank(operator);
        uint256 paid = marketDriver.withdraw(aliceNft, v1, address(0));
        assertGt(paid, 0, "operator triggered payout to owner");
        assertEq(usdc.balanceOf(alice), paid, "funds went to the owner, not the operator");
        assertEq(usdc.balanceOf(operator), 0, "operator got nothing");
    }

    function test_loserWithdrawIsNoOp() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(Vault.Outcome.Yes);
        vault.collect(v1);

        vm.prank(bob);
        assertEq(marketDriver.withdraw(bobNft, v1, address(0)), 0, "loser gets nothing from winnings");
    }

    function test_multipleWinnersSplitByShares() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 50 * RATE);
        _fund(carol, carolNft, Side.Yes, 2 * RATE, 100 * RATE);
        _fund(bob, bobNft, Side.No, RATE, 50 * RATE);

        vm.warp(200);
        _resolve(Vault.Outcome.Yes);
        vault.collect(v1);

        uint256 potV = vault.pot(v1);
        assertEq(potV, 200 * RATE, "pot = 50 + 100 + 50");

        vm.prank(alice);
        uint256 aPay = marketDriver.withdraw(aliceNft, v1, address(0));
        vm.prank(carol);
        uint256 cPay = marketDriver.withdraw(carolNft, v1, address(0));

        assertApproxEqAbs(cPay, 2 * aPay, 10, "2x rate => ~2x payout");
        assertApproxEqAbs(aPay + cPay, potV, 2, "winners split the whole pot");
    }

    function test_doubleWithdrawIsNoOp() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(Vault.Outcome.Yes);
        vault.collect(v1);

        vm.prank(alice);
        marketDriver.withdraw(aliceNft, v1, address(0));
        vm.prank(alice);
        assertEq(marketDriver.withdraw(aliceNft, v1, address(0)), 0, "second withdraw is free no-op");
    }

    function test_collectIsIdempotent() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(Vault.Outcome.Yes);
        vault.collect(v1);
        uint256 pot1 = vault.pot(v1);
        vault.collect(v1);
        assertEq(vault.pot(v1), pot1, "pot unchanged on re-collect");
    }

    function test_withdrawBeforeCollectIsNoOp() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(Vault.Outcome.Yes);
        vm.prank(alice);
        assertEq(marketDriver.withdraw(aliceNft, v1, address(0)), 0, "nothing before collect");
    }

    function test_onlyStewardCanResolve() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert("StewardRegistry: not market steward");
        stewardRegistry.resolveVault(v1, Vault.Outcome.Yes);
    }

    function test_vaultDriverCannotResolveDirectly() public {
        vm.prank(address(vaultDriver));
        vm.expectRevert("Vault: not resolver");
        vault.resolve(v1, Vault.Outcome.Yes);
    }

    /// Pot is Board truth at resolvedAt; after lanes stop, harvest on cycle end pays the full pot.
    function test_earlyCollect_potCorrectBeforeHarvest() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 10 * RATE);
        _fund(bob, bobNft, Side.No, RATE, 10 * RATE);

        vm.warp(105);
        _resolve(Vault.Outcome.Yes);
        vm.prank(alice);
        marketDriver.stop(aliceNft, v1, Side.Yes);
        vm.prank(bob);
        marketDriver.stop(bobNft, v1, Side.No);
        vault.collect(v1);
        assertEq(vault.pot(v1), 10 * RATE, "pot = Board truth at 105");

        vm.warp(110);
        vault.collect(v1);

        vm.prank(alice);
        assertEq(marketDriver.withdraw(aliceNft, v1, address(0)), 10 * RATE, "winner paid after cycle harvest");
    }

    function test_withdrawNeedsHarvestedCash() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 10 * RATE);
        _fund(bob, bobNft, Side.No, RATE, 10 * RATE);

        vm.warp(105);
        _resolve(Vault.Outcome.Yes);
        vm.prank(alice);
        marketDriver.stop(aliceNft, v1, Side.Yes);
        vm.prank(bob);
        marketDriver.stop(bobNft, v1, Side.No);
        vault.collect(v1);

        vm.prank(alice);
        vm.expectRevert();
        marketDriver.withdraw(aliceNft, v1, address(0));

        vm.warp(110);
        vault.collect(v1);
        vm.prank(alice);
        assertEq(marketDriver.withdraw(aliceNft, v1, address(0)), 10 * RATE, "succeeds once cash is in");
    }

    function test_overageRefundedViaWithdrawWithoutStop() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, Side.No, RATE, 50 * RATE);

        vm.warp(120);
        _resolve(Vault.Outcome.Yes);

        vm.warp(130);
        vault.collect(v1);
        assertEq(vault.pot(v1), 40 * RATE, "pot = Board truth at 120");

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 paid = marketDriver.withdraw(aliceNft, v1, address(0));
        assertEq(paid, 50 * RATE, "alice: pot (40) + live overage (10 through t=130)");

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        assertEq(marketDriver.withdraw(bobNft, v1, address(0)), 10 * RATE, "bob reclaims overage through t=130");
        assertEq(usdc.balanceOf(bob) - bobBefore, 10 * RATE);
        assertEq(usdc.balanceOf(alice) - aliceBefore, paid);
        assertEq(usdc.balanceOf(address(vault)), 0, "vault fully drained");
    }

    function test_liveOverageGuard_maxEndAtOrBeforeResolvedAt() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 20 * RATE);
        vm.warp(120);
        _resolve(Vault.Outcome.Yes);
        vault.collect(v1);

        vm.prank(alice);
        assertEq(marketDriver.withdraw(aliceNft, v1, address(0)), 20 * RATE, "no overage when maxEnd <= resolvedAt");
        assertEq(vault.overagePaid(v1, Side.Yes, aliceNft), 0, "no live overage accrued");
    }

    function test_overageDoesNotInflatePot() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, Side.No, RATE, 50 * RATE);
        vm.warp(120);
        _resolve(Vault.Outcome.Yes);
        vm.warp(140);
        vm.prank(alice);
        marketDriver.stop(aliceNft, v1, Side.Yes);
        vm.prank(bob);
        marketDriver.stop(bobNft, v1, Side.No);
        vault.collect(v1);
        assertEq(vault.pot(v1), 40 * RATE, "pot excludes post-resolution streaming");
    }

    function test_withdrawBeforeCollectOverageIsNoOp() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 50 * RATE);
        vm.warp(120);
        _resolve(Vault.Outcome.Yes);
        vm.warp(135);
        vm.prank(alice);
        assertEq(marketDriver.withdraw(aliceNft, v1, address(0)), 0, "no payout before collect");
    }

    function test_claimablePreviewMatchesWithdraw() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(Vault.Outcome.Yes);

        assertEq(vault.claimable(aliceNft, v1, Side.Yes), 0, "0 before collect");
        vault.collect(v1);

        uint256 preview = vault.claimable(aliceNft, v1, Side.Yes);
        assertEq(preview, 100 * RATE, "preview = whole pot");

        vm.prank(alice);
        assertEq(marketDriver.withdraw(aliceNft, v1, address(0)), preview, "withdraw matches preview");
        assertEq(vault.claimable(aliceNft, v1, Side.Yes), 0, "0 after withdraw");
    }

    function test_getAccountVaultIds() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 50 * RATE);
        vm.warp(120);
        vm.prank(alice);
        marketDriver.stop(aliceNft, v1, Side.Yes);
        _fund(alice, aliceNft, Side.Yes, RATE, 50 * RATE);

        bytes32[] memory av = vault.getAccountVaultIds(aliceNft);
        assertEq(av.length, 1, "repeat funds dedupe");
        assertEq(av[0], v1);

        bytes32 marketId2 = marketRegistry.registerMarket("m2", bytes32("s2"));
        bytes32 v2 = VaultDriverHarness.bondVault(vaultDriver, usdc, marketId2, "Q2?", Side.Yes);
        uint256 aliceNft2 = MarketDriverHarness.mint(marketDriver, alice, marketId2);
        MarketDriverHarness.fund(marketDriver, usdc, alice, aliceNft2, v2, Side.Yes, RATE, 50 * RATE);

        assertEq(vault.getAccountVaultIds(aliceNft2).length, 1, "second NFT has its vault");
        _fund(bob, bobNft, Side.No, RATE, 50 * RATE);
        assertEq(vault.getAccountVaultIds(bobNft).length, 1, "per-account isolation");
    }

    function test_nftTransfer_carriesWithdrawRights() public {
        _fund(alice, aliceNft, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(Vault.Outcome.Yes);
        vault.collect(v1);

        vm.prank(alice);
        marketDriver.transferFrom(alice, carol, aliceNft);

        vm.prank(alice);
        vm.expectRevert("MarketDriver: not holder");
        marketDriver.withdraw(aliceNft, v1, address(0));

        vm.prank(carol);
        assertEq(marketDriver.withdraw(aliceNft, v1, address(0)), 100 * RATE, "new holder paid");
    }

    function test_winningSide() public {
        vm.expectRevert("Vault: not resolved");
        vault.winningSide(v1);
        _resolve(Vault.Outcome.No);
        assertEq(uint256(vault.winningSide(v1)), uint256(Side.No), "winning side = NO");
    }
}
