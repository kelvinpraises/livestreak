// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DripsStreaming} from "../../src/streaming/DripsStreaming.sol";
import {ManagedProxy} from "../../src/streaming/Managed.sol";
import {IDrips} from "../../src/streaming/IDrips.sol";
import {AddressDriver} from "../../src/streaming/drivers/AddressDriver.sol";
import {Vault} from "../../src/vault/Vault.sol";
import {VaultFactory} from "../../src/vault/VaultFactory.sol";
import {Side} from "../../src/vault/Side.sol";
import {BookmakerRegistry} from "../../src/bookmaker/BookmakerRegistry.sol";
import {MarketRegistry} from "../../src/market/MarketRegistry.sol";
import {StewardRegistry} from "../../src/steward/StewardRegistry.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @notice Proves resolution: the winning side drains the whole pot (their stake + the losing side's
/// bounty), split by shares; losers and double claims revert. Streams deplete before resolution
/// (cycle-aligned), so the collected USDC equals the Board pools exactly.
contract VaultResolutionTest is Test {
    uint32 internal constant CYCLE = 10;
    uint256 internal constant START = 100;
    uint256 internal constant RATE = 1_000_000;

    DripsStreaming internal drips;
    MockUSDC internal usdc;
    Vault internal vault;
    VaultFactory internal vaultFactory;
    BookmakerRegistry internal bookmakerRegistry;
    MarketRegistry internal marketRegistry;
    StewardRegistry internal stewardRegistry;
    AddressDriver internal addressDriver;

    bytes32 internal v1;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal steward = makeAddr("steward");

    function setUp() public {
        vm.warp(START);

        DripsStreaming logic = new DripsStreaming(CYCLE);
        drips = DripsStreaming(address(new ManagedProxy(logic, address(this), "")));
        usdc = new MockUSDC();

        bookmakerRegistry = new BookmakerRegistry(address(this));
        marketRegistry = new MarketRegistry(address(this));
        vault = new Vault();
        vaultFactory = new VaultFactory(bookmakerRegistry, marketRegistry, vault);
        vault.setFactory(address(vaultFactory));
        marketRegistry.setVaultFactory(address(vaultFactory));
        bookmakerRegistry.setBookmaker(address(this), true);

        vault.setStreaming(IDrips(address(drips)), IERC20(address(usdc)));
        uint32 id = drips.registerDriver(address(this));
        AddressDriver dl = new AddressDriver(IDrips(address(drips)), address(0), id, vault, IERC20(address(usdc)));
        addressDriver = AddressDriver(address(new ManagedProxy(dl, address(this), "")));
        drips.updateDriverAddress(id, address(addressDriver));
        vault.setFundingDriver(address(addressDriver));

        // Steward path is the Vault's resolver; every test resolves through a registered steward.
        stewardRegistry = new StewardRegistry(address(this));
        stewardRegistry.setVault(address(vault));
        vault.setResolver(address(stewardRegistry));
        stewardRegistry.registerSteward(steward);

        bytes32 marketId = marketRegistry.registerMarket("m", bytes32("s"));
        v1 = vaultFactory.createVault(marketId, "Q?");
    }

    function _fund(address who, Side side, uint256 rate, uint256 deposit) internal {
        usdc.mint(who, deposit);
        vm.startPrank(who);
        usdc.approve(address(addressDriver), deposit);
        addressDriver.fund(v1, side, rate, deposit);
        vm.stopPrank();
    }

    function _resolve(Vault.Outcome outcome) internal {
        vm.prank(steward);
        stewardRegistry.resolveVault(v1, outcome);
    }

    /// Sole winner takes the whole pot — their stake plus the losing side's bounty.
    function test_winnerTakesPot() public {
        _fund(alice, Side.Yes, RATE, 50 * RATE);
        _fund(bob, Side.No, RATE, 50 * RATE);

        vm.warp(200); // both depleted at 150
        _resolve(Vault.Outcome.Yes);
        vault.collect(v1);
        assertEq(vault.pot(v1), 100 * RATE, "pot = both pools");

        vm.prank(alice);
        uint256 payout = addressDriver.claim(v1, Side.Yes);
        assertEq(payout, 100 * RATE, "sole winner takes all");
        assertEq(usdc.balanceOf(alice), 100 * RATE);
    }

    function test_loserCannotClaim() public {
        _fund(alice, Side.Yes, RATE, 50 * RATE);
        _fund(bob, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(Vault.Outcome.Yes);
        vault.collect(v1);

        vm.prank(bob);
        vm.expectRevert("Vault: not winning side");
        addressDriver.claim(v1, Side.No);
    }

    /// Multiple winners split the pot by shares; 2x rate over the same window ≈ 2x payout.
    function test_multipleWinnersSplitByShares() public {
        _fund(alice, Side.Yes, RATE, 50 * RATE); // rate R, runs [100,150]
        _fund(carol, Side.Yes, 2 * RATE, 100 * RATE); // rate 2R, runs [100,150]
        _fund(bob, Side.No, RATE, 50 * RATE);

        vm.warp(200);
        _resolve(Vault.Outcome.Yes);
        vault.collect(v1);

        uint256 potV = vault.pot(v1);
        assertEq(potV, 200 * RATE, "pot = 50 + 100 + 50");

        vm.prank(alice);
        uint256 aPay = addressDriver.claim(v1, Side.Yes);
        vm.prank(carol);
        uint256 cPay = addressDriver.claim(v1, Side.Yes);

        assertApproxEqAbs(cPay, 2 * aPay, 10, "2x rate => ~2x payout");
        assertApproxEqAbs(aPay + cPay, potV, 2, "winners split the whole pot");
    }

    function test_doubleClaimReverts() public {
        _fund(alice, Side.Yes, RATE, 50 * RATE);
        _fund(bob, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(Vault.Outcome.Yes);
        vault.collect(v1);

        vm.prank(alice);
        addressDriver.claim(v1, Side.Yes);
        vm.prank(alice);
        vm.expectRevert("Vault: already claimed");
        addressDriver.claim(v1, Side.Yes);
    }

    /// Collect is now idempotent (it gathers liquidity; the pot is the Board truth). Re-calling it is
    /// safe and leaves the pot unchanged.
    function test_collectIsIdempotent() public {
        _fund(alice, Side.Yes, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(Vault.Outcome.Yes);
        vault.collect(v1);
        uint256 pot1 = vault.pot(v1);
        vault.collect(v1); // no revert
        assertEq(vault.pot(v1), pot1, "pot unchanged on re-collect");
    }

    function test_claimBeforeCollectReverts() public {
        _fund(alice, Side.Yes, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(Vault.Outcome.Yes);
        vm.prank(alice);
        vm.expectRevert("Vault: not collected");
        addressDriver.claim(v1, Side.Yes);
    }

    // ── Steward-gated resolution ────────────────────────────────────────────

    /// Only a registered steward may resolve through the registry.
    function test_onlyStewardCanResolve() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert("StewardRegistry: not steward");
        stewardRegistry.resolveVault(v1, Vault.Outcome.Yes);
    }

    /// The factory (and anyone but the resolver) can no longer flip the outcome directly.
    function test_factoryCannotResolveDirectly() public {
        vm.prank(address(vaultFactory));
        vm.expectRevert("Vault: not resolver");
        vault.resolve(v1, Vault.Outcome.Yes);
    }

    // ── Mid-cycle resolution (pot-from-Board + in-flight squeeze) ───────────

    /// The pot is the Board truth at resolvedAt, so an early `collect` — before anyone settles — cannot
    /// strand it. Resolution lands inside the first cycle (nothing receivable yet), yet the pot is
    /// already exact. Collect is idempotent, so a later settle + re-collect brings the cash in and the
    /// winner is paid in full. This is the direct proof that the old collect-ordering footgun is gone.
    function test_potIsBoardTruthRegardlessOfCollectOrder() public {
        _fund(alice, Side.Yes, RATE, 50 * RATE);
        _fund(bob, Side.No, RATE, 50 * RATE);

        vm.warp(105); // mid first cycle [100,110): no finished cycle, zero cash receivable
        _resolve(Vault.Outcome.Yes);

        vault.collect(v1); // early collect, before any settle: pulls no cash
        assertEq(vault.pot(v1), 10 * RATE, "pot = Board truth even with zero cash collected");

        addressDriver.settle(alice);
        addressDriver.settle(bob);
        vault.collect(v1); // idempotent re-collect now banks the squeezed in-flight cash

        vm.prank(alice);
        assertEq(addressDriver.claim(v1, Side.Yes), 10 * RATE, "winner paid in full after settle + re-collect");
    }

    /// Mirror image: with the pot correct but the cash not yet settled, the winner's claim reverts for
    /// lack of liquidity (not a wrong amount). Settling the active funders fixes it.
    function test_midCycleClaimNeedsSettledCash() public {
        _fund(alice, Side.Yes, RATE, 50 * RATE);
        _fund(bob, Side.No, RATE, 50 * RATE);

        vm.warp(105);
        _resolve(Vault.Outcome.Yes);
        vault.collect(v1);
        assertEq(vault.pot(v1), 10 * RATE);

        vm.prank(alice);
        vm.expectRevert(); // ERC20 transfer exceeds the vault's (zero) balance
        addressDriver.claim(v1, Side.Yes);

        assertEq(uint256(addressDriver.settle(alice)), 5 * RATE, "alice in-flight squeezed");
        assertEq(uint256(addressDriver.settle(bob)), 5 * RATE, "bob in-flight squeezed");
        vault.collect(v1);
        vm.prank(alice);
        assertEq(addressDriver.claim(v1, Side.Yes), 10 * RATE, "claim succeeds once cash is in");
    }

    /// Exercises the `histBefore != 0` path: an address funds, stops, then funds again, so its second
    /// stream sits behind prior Drips history. `settle` must still squeeze the in-flight cycle.
    function test_settleAfterAccountReuse() public {
        _fund(alice, Side.Yes, RATE, 50 * RATE); // first position, fresh account (histBefore == 0)
        vm.warp(120);
        vm.prank(alice);
        addressDriver.stop(); // frees the account; the next fund records a non-zero histBefore

        _fund(alice, Side.Yes, RATE, 50 * RATE); // second position reuses the same account
        vm.warp(125); // mid-cycle of the second stream (started at 120)
        _resolve(Vault.Outcome.Yes);

        assertEq(uint256(addressDriver.settle(alice)), 5 * RATE, "reused-account in-flight squeezed");
    }

    // ── Over-stream refund (idea 3) ─────────────────────────────────────────

    /// A funder who keeps streaming past resolution gets that overage back; it is never in the pot. End
    /// state is exactly solvent: every collected dollar is either pot (to the winner) or overage (back
    /// to the streamer). Resolve at 120 (each side streamed 20·RATE → pot 40·RATE); both over-stream to
    /// 135 (15·RATE each) before stopping.
    function test_overageRefundedToFunder() public {
        _fund(alice, Side.Yes, RATE, 50 * RATE);
        _fund(bob, Side.No, RATE, 50 * RATE);

        vm.warp(120);
        _resolve(Vault.Outcome.Yes);

        vm.warp(135);
        vm.prank(alice);
        addressDriver.stop();
        vm.prank(bob);
        addressDriver.stop();

        assertEq(vault.overageOwed(v1, Side.Yes, alice), 15 * RATE, "alice overage recorded");
        assertEq(vault.overageOwed(v1, Side.No, bob), 15 * RATE, "bob overage recorded");

        vault.collect(v1);
        assertEq(vault.pot(v1), 40 * RATE, "pot = Board truth at 120, overage excluded");

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        addressDriver.claim(v1, Side.Yes);
        vm.prank(alice);
        addressDriver.reclaim(v1, Side.Yes);
        assertEq(usdc.balanceOf(alice) - aliceBefore, 55 * RATE, "alice: pot (40) + overage (15)");

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        addressDriver.reclaim(v1, Side.No);
        assertEq(usdc.balanceOf(bob) - bobBefore, 15 * RATE, "bob (loser) reclaims only overage");

        assertEq(usdc.balanceOf(address(vault)), 0, "vault fully drained: pot + overages == collected");
    }

    /// Over-streaming does not inflate the pot — the pot stays the Board truth at resolvedAt.
    function test_overageDoesNotInflatePot() public {
        _fund(alice, Side.Yes, RATE, 50 * RATE);
        _fund(bob, Side.No, RATE, 50 * RATE);
        vm.warp(120);
        _resolve(Vault.Outcome.Yes);
        vm.warp(140); // 20·RATE of overage each, well past resolution
        vm.prank(alice);
        addressDriver.stop();
        vm.prank(bob);
        addressDriver.stop();
        vault.collect(v1);
        assertEq(vault.pot(v1), 40 * RATE, "pot excludes all post-resolution streaming");
    }

    function test_reclaimRevertsBeforeCollect() public {
        _fund(alice, Side.Yes, RATE, 50 * RATE);
        vm.warp(120);
        _resolve(Vault.Outcome.Yes);
        vm.warp(135);
        vm.prank(alice);
        addressDriver.stop();
        vm.prank(alice);
        vm.expectRevert("Vault: not collected");
        addressDriver.reclaim(v1, Side.Yes);
    }

    function test_doubleReclaimReverts() public {
        _fund(alice, Side.Yes, RATE, 50 * RATE);
        vm.warp(120);
        _resolve(Vault.Outcome.Yes);
        vm.warp(135);
        vm.prank(alice);
        addressDriver.stop();
        vault.collect(v1);
        vm.prank(alice);
        addressDriver.reclaim(v1, Side.Yes);
        vm.prank(alice);
        vm.expectRevert("Vault: no overage");
        addressDriver.reclaim(v1, Side.Yes);
    }

    // ── Reads — preview, enumeration, winning side ──────────────────────────

    /// `claimable` is view-parity with the actual payout: 0 before collect, exact after, 0 after claim.
    function test_claimablePreviewMatchesPayout() public {
        _fund(alice, Side.Yes, RATE, 50 * RATE);
        _fund(bob, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(Vault.Outcome.Yes);

        assertEq(vault.claimable(alice, v1, Side.Yes), 0, "0 before collect (pot not final)");
        vault.collect(v1);

        uint256 preview = vault.claimable(alice, v1, Side.Yes);
        assertEq(preview, 100 * RATE, "preview = whole pot (sole YES)");
        assertEq(vault.claimable(bob, v1, Side.No), 0, "loser previews 0");

        vm.prank(alice);
        assertEq(addressDriver.claim(v1, Side.Yes), preview, "preview matches actual payout");
        assertEq(vault.claimable(alice, v1, Side.Yes), 0, "0 after claim");
    }

    /// Preview parity holds under a split: carol streams 2x rate → 2x payout; previews sum to the pot.
    function test_claimablePreviewMultiWinner() public {
        _fund(alice, Side.Yes, RATE, 50 * RATE);
        _fund(carol, Side.Yes, 2 * RATE, 100 * RATE);
        _fund(bob, Side.No, RATE, 50 * RATE);
        vm.warp(200);
        _resolve(Vault.Outcome.Yes);
        vault.collect(v1);

        uint256 pa = vault.claimable(alice, v1, Side.Yes);
        uint256 pc = vault.claimable(carol, v1, Side.Yes);
        assertApproxEqAbs(pc, 2 * pa, 2, "carol ~2x alice");
        assertApproxEqAbs(pa + pc, vault.pot(v1), 2, "previews sum to the pot");

        vm.prank(alice);
        assertEq(addressDriver.claim(v1, Side.Yes), pa, "alice preview == payout");
        vm.prank(carol);
        assertEq(addressDriver.claim(v1, Side.Yes), pc, "carol preview == payout");
    }

    /// `getUserVaultIds` dedupes repeat funds of one vault, appends distinct vaults, isolates per user.
    function test_getUserVaultIds() public {
        _fund(alice, Side.Yes, RATE, 50 * RATE);
        vm.warp(120);
        vm.prank(alice);
        addressDriver.stop();
        _fund(alice, Side.Yes, RATE, 50 * RATE); // same vault again → must not double-count

        bytes32[] memory av = vault.getUserVaultIds(alice);
        assertEq(av.length, 1, "repeat funds of one vault dedupe");
        assertEq(av[0], v1);

        bytes32 marketId = marketRegistry.registerMarket("m2", bytes32("s2"));
        bytes32 v2 = vaultFactory.createVault(marketId, "Q2?");
        vm.warp(140);
        vm.prank(alice);
        addressDriver.stop();
        usdc.mint(alice, 50 * RATE);
        vm.startPrank(alice);
        usdc.approve(address(addressDriver), 50 * RATE);
        addressDriver.fund(v2, Side.Yes, RATE, 50 * RATE);
        vm.stopPrank();

        av = vault.getUserVaultIds(alice);
        assertEq(av.length, 2, "distinct vault appended");
        assertEq(av[1], v2);

        _fund(bob, Side.No, RATE, 50 * RATE);
        assertEq(vault.getUserVaultIds(bob).length, 1, "per-user isolation");
        assertEq(vault.getUserVaultIds(makeAddr("nobody")).length, 0, "unfunded user is empty");
    }

    function test_winningSide() public {
        vm.expectRevert("Vault: not resolved");
        vault.winningSide(v1);
        _resolve(Vault.Outcome.No);
        assertEq(uint256(vault.winningSide(v1)), uint256(Side.No), "winning side = NO");
    }
}
