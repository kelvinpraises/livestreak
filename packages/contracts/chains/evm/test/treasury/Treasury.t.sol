// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DripsStreaming} from "../../solidity/streaming/DripsStreaming.sol";
import {MarketDriver} from "../../solidity/streaming/drivers/MarketDriver.sol";
import {VaultDriver} from "../../solidity/streaming/drivers/VaultDriver.sol";
import {Vault} from "../../solidity/vault/Vault.sol";
import {LvstToken} from "../../solidity/treasury/LvstToken.sol";
import {Treasury} from "../../solidity/treasury/Treasury.sol";
import {Side} from "../../solidity/vault/Side.sol";
import {MarketRegistry} from "../../solidity/registries/MarketRegistry.sol";
import {StewardRegistry} from "../../solidity/steward/StewardRegistry.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {ProtocolWire} from "../helpers/ProtocolWire.sol";
import {MarketDriverHarness} from "../helpers/MarketDriverHarness.sol";
import {VaultDriverHarness} from "../helpers/VaultDriverHarness.sol";

contract TreasuryTest is Test {
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
    LvstToken internal lvst;
    Treasury internal treasury;

    bytes32 internal marketId;
    bytes32 internal v1;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal steward = makeAddr("steward");

    uint256 internal aliceNft;
    uint256 internal bobNft;
    uint256 internal carolNft;
    uint256 internal daveNft;

    function setUp() public {
        vm.warp(START);

        usdc = new MockUSDC();
        ProtocolWire.Core memory core = ProtocolWire.deployCore(address(this), IERC20(address(usdc)));
        marketRegistry = core.marketRegistry;
        vault = core.vault;
        stewardRegistry = core.stewardRegistry;
        lvst = core.lvstToken;
        treasury = core.treasury;

        ProtocolWire.Streaming memory streaming = ProtocolWire.deployStreaming(address(this), vault, usdc, CYCLE);
        streaming = ProtocolWire.wireAll(address(this), core, streaming);
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
        daveNft = MarketDriverHarness.mint(marketDriver, dave, marketId);
    }

    function _fund(address who, uint256 tokenId, bytes32 vid, Side side, uint256 rate, uint256 deposit) internal {
        MarketDriverHarness.fund(marketDriver, usdc, who, tokenId, vid, side, rate, deposit);
    }

    function _resolve(bytes32 vid, Vault.Outcome outcome) internal {
        vm.prank(steward);
        stewardRegistry.resolveVault(vid, outcome);
    }

    function _newVault() internal returns (bytes32) {
        return VaultDriverHarness.bondVault(vaultDriver, usdc, marketId, "Q2?", Side.Yes);
    }

    /// A vault resolved to a side with zero winner shares sweeps the whole pot to the Treasury house pot
    /// (no pro-rata payees) instead of stranding it; losers still keep their LVST loss basis.
    function test_collect_zeroWinnerShares_sweepsPotToTreasury() public {
        // Seeded + funded only on NO, resolved YES → winning side (YES) has 0 shares.
        bytes32 vz = VaultDriverHarness.bondVault(vaultDriver, usdc, marketId, "ZeroWin?", Side.No);
        _fund(bob, bobNft, vz, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(vz, Vault.Outcome.Yes);

        uint256 treasuryBefore = usdc.balanceOf(address(treasury));
        vault.collect(vz);
        vm.warp(200 + CYCLE * 3); // let cycles complete so harvest banks the NO pool
        vault.collect(vz); // harvest + flush the sweep

        (,, uint256 yesShareTotal,) = vault.getVaultPools(vz);
        assertEq(yesShareTotal, 0, "winning YES side has 0 shares");
        assertEq(vault.pot(vz), 0, "pot zeroed - no winner can withdraw");
        assertGt(usdc.balanceOf(address(treasury)) - treasuryBefore, 0, "pot swept to the treasury house pot");
        assertGt(vault.lossClaimable(bobNft, vz, Side.No), 0, "loser keeps the LVST loss basis");
    }

    function test_lossMintsFlowOnCurve() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, v1, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(v1, Vault.Outcome.Yes);
        vault.collect(v1);

        assertEq(vault.lossClaimable(bobNft, v1, Side.No), 50 * RATE, "bob lost his streamed $50");
        assertEq(vault.lossClaimable(aliceNft, v1, Side.Yes), 0, "winner has no loss");

        uint256 rate = treasury.mintRate();
        uint256 expected = (uint256(50 * RATE) * rate) / 1e6;
        vm.prank(bob);
        uint256 minted = marketDriver.claimLossLvst(bobNft, v1, Side.No, address(0));
        assertEq(minted, expected, "LVST = lostUSD x mintRate");
        assertEq(lvst.balanceOf(bob), expected);

        vm.prank(bob);
        vm.expectRevert("Treasury: already claimed");
        marketDriver.claimLossLvst(bobNft, v1, Side.No, address(0));

        vm.prank(alice);
        vm.expectRevert("Treasury: nothing lost");
        marketDriver.claimLossLvst(aliceNft, v1, Side.Yes, address(0));
    }

    function test_skimReducesPotAndFeedsHousePot() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, v1, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(v1, Vault.Outcome.Yes);
        vault.collect(v1);

        uint256 skim = (50 * RATE * 200) / 10_000;
        assertEq(treasury.totalSkimmed(), skim, "house pot took the skim");
        assertEq(vault.pot(v1), 100 * RATE - skim, "pot = winPool + 98% of bounty");
        assertEq(usdc.balanceOf(address(treasury)), skim, "skim USDC sits in the house pot");

        vm.prank(alice);
        assertEq(marketDriver.withdraw(aliceNft, v1, address(0)), 100 * RATE - skim, "winner takes reduced pot");
    }

    function test_noLossNoSkimFullRefund() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(v1, Vault.Outcome.Yes);
        vault.collect(v1);

        assertEq(treasury.totalSkimmed(), 0, "nothing skimmed with no bounty");
        assertEq(vault.pot(v1), 50 * RATE, "pot = winner's own money");
        vm.prank(alice);
        assertEq(marketDriver.withdraw(aliceNft, v1, address(0)), 50 * RATE, "winner fully refunded");
    }

    function test_stakeEarnsDividends() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, v1, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(v1, Vault.Outcome.Yes);
        vault.collect(v1);
        vm.startPrank(bob);
        uint256 bobFlow = marketDriver.claimLossLvst(bobNft, v1, Side.No, address(0));
        treasury.stakeLvst(bobFlow);
        vm.stopPrank();
        assertEq(treasury.lvstStaked(bob), bobFlow);

        bytes32 v2 = _newVault();
        _fund(carol, carolNft, v2, Side.Yes, RATE, 50 * RATE);
        _fund(dave, daveNft, v2, Side.No, RATE, 50 * RATE);
        vm.warp(400);
        _resolve(v2, Vault.Outcome.Yes);
        vault.collect(v2);

        uint256 pending = treasury.pendingDividends(bob);
        assertLe(pending, treasury.totalSkimmed(), "never over-distribute");
        assertApproxEqAbs(pending, treasury.totalSkimmed(), 1e4, "sole staker earns ~every skim");
        assertGt(pending, 0);

        uint256 before = usdc.balanceOf(bob);
        vm.prank(bob);
        uint256 paid = treasury.claimDividends();
        assertEq(paid, pending, "dividends paid in USDC");
        assertEq(usdc.balanceOf(bob) - before, paid);
        assertEq(treasury.pendingDividends(bob), 0, "settled");
    }

    function test_claimAndStakeLossLvst() public {
        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, v1, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(v1, Vault.Outcome.Yes);
        vault.collect(v1);

        vm.startPrank(bob);
        uint256 minted = marketDriver.claimLossLvst(bobNft, v1, Side.No, address(0));
        treasury.stakeLvst(minted);
        vm.stopPrank();
        assertEq(treasury.lvstStaked(bob), minted, "minted LVST is staked");
        assertEq(lvst.balanceOf(bob), 0, "nothing left liquid");
    }

    function test_mintRateDecaysWithPool() public {
        assertEq(treasury.mintRate(), treasury.mintStart(), "empty pot -> start rate");

        _fund(alice, aliceNft, v1, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, v1, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(v1, Vault.Outcome.Yes);
        vault.collect(v1);

        assertLt(treasury.mintRate(), treasury.mintStart(), "skim grew the pot -> rate decayed");
        assertGe(treasury.mintRate(), treasury.mintFloor(), "never below the floor");
    }

    function test_washSelfLimits() public {
        treasury.setMintParams(100e18, 1e18, 100 * RATE);

        uint256 r0 = treasury.mintRate();

        bytes32 vA = v1;
        _fund(alice, aliceNft, vA, Side.Yes, RATE, 50 * RATE);
        _fund(bob, bobNft, vA, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(vA, Vault.Outcome.Yes);
        vault.collect(vA);
        uint256 r1 = treasury.mintRate();

        bytes32 vB = _newVault();
        _fund(carol, carolNft, vB, Side.Yes, RATE, 50 * RATE);
        _fund(dave, daveNft, vB, Side.No, RATE, 50 * RATE);
        vm.warp(400);
        _resolve(vB, Vault.Outcome.Yes);
        vault.collect(vB);
        uint256 r2 = treasury.mintRate();

        assertLt(r1, r0, "rate fell after the first wash");
        assertLt(r2, r1, "and fell again after the second");
        assertGt(treasury.totalSkimmed(), 0, "skims accumulate in the pot that backs LVST");
    }
}
