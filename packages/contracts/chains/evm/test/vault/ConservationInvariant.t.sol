// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DripsStreaming} from "../../solidity/streaming/DripsStreaming.sol";
import {MarketDriver} from "../../solidity/streaming/drivers/MarketDriver.sol";
import {VaultDriver} from "../../solidity/streaming/drivers/VaultDriver.sol";
import {Vault} from "../../solidity/vault/Vault.sol";
import {Treasury} from "../../solidity/treasury/Treasury.sol";
import {Side} from "../../solidity/vault/Side.sol";
import {MarketRegistry} from "../../solidity/registries/MarketRegistry.sol";
import {StewardRegistry} from "../../solidity/steward/StewardRegistry.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {ProtocolWire} from "../helpers/ProtocolWire.sol";
import {MarketDriverHarness} from "../helpers/MarketDriverHarness.sol";
import {VaultDriverHarness} from "../helpers/VaultDriverHarness.sol";

/// @notice Conservation invariant: every deposited dollar is skim, recovery, or zero residual.
contract ConservationInvariantTest is Test {
    uint32 internal constant CYCLE = 10;
    uint256 internal constant START = 100;
    uint256 internal constant RATE = 1_000_000;
    uint256 internal constant CREATOR_SEED = 10 * RATE;

    DripsStreaming internal drips;
    MockUSDC internal usdc;
    Vault internal vault;
    VaultDriver internal vaultDriver;
    Treasury internal treasury;
    MarketDriver internal marketDriver;
    StewardRegistry internal stewardRegistry;

    bytes32 internal marketId;
    bytes32 internal vaultId;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal steward = makeAddr("steward");

    uint256 internal aliceNft;
    uint256 internal bobNft;

    function setUp() public {
        vm.warp(START);

        usdc = new MockUSDC();
        ProtocolWire.Core memory core = ProtocolWire.deployCore(address(this), IERC20(address(usdc)));
        vault = core.vault;
        treasury = core.treasury;
        stewardRegistry = core.stewardRegistry;

        ProtocolWire.Streaming memory streaming = ProtocolWire.deployStreaming(address(this), vault, usdc, CYCLE);
        streaming = ProtocolWire.wireAll(address(this), core, streaming);
        drips = streaming.drips;
        marketDriver = streaming.marketDriver;
        vaultDriver = core.vaultDriver;

        stewardRegistry.registerSteward(steward);
        stewardRegistry.setDefaultSteward(steward);
        marketId = core.marketRegistry.registerMarket("m", bytes32("s"));
        vaultId = VaultDriverHarness.createVault(
            vaultDriver, usdc, VaultDriverHarness.SEED_CREATOR, marketId, "Q?", Side.Yes, RATE, CREATOR_SEED
        );

        aliceNft = MarketDriverHarness.mint(marketDriver, alice, marketId);
        bobNft = MarketDriverHarness.mint(marketDriver, bob, marketId);
    }

    /// Σ deposits == skim + stopAll refunds + withdraw payees; vault and drips drain to zero.
    function testFuzz_conservationInvariant(uint256 seed) public {
        seed = bound(seed, 1, type(uint128).max);

        uint256 totalDeposits = CREATOR_SEED;
        uint256 totalStopAllRefunds;
        uint256 totalWithdraws;

        bool aliceFunded;
        bool bobFunded;

        uint256 steps = 3 + (seed % 5);
        for (uint256 i = 0; i < steps; i++) {
            uint256 op = uint256(keccak256(abi.encode(seed, i))) % 4;
            uint256 deposit = RATE * (2 + (uint256(keccak256(abi.encode(seed, i, "d"))) % 18));

            if (op == 0 && !aliceFunded) {
                totalDeposits += deposit;
                MarketDriverHarness.fund(marketDriver, usdc, alice, aliceNft, vaultId, Side.Yes, RATE, deposit);
                aliceFunded = true;
            } else if (op == 1 && !bobFunded) {
                totalDeposits += deposit;
                MarketDriverHarness.fund(marketDriver, usdc, bob, bobNft, vaultId, Side.No, RATE, deposit);
                bobFunded = true;
            } else if (op == 2) {
                vm.warp(block.timestamp + 1 + (seed % 7));
            } else {
                vault.advance(vaultId, Side.Yes, 64);
                vault.advance(vaultId, Side.No, 64);
            }
        }

        if (!aliceFunded) {
            uint256 deposit = 10 * RATE;
            totalDeposits += deposit;
            MarketDriverHarness.fund(marketDriver, usdc, alice, aliceNft, vaultId, Side.Yes, RATE, deposit);
        }
        if (!bobFunded) {
            uint256 deposit = 10 * RATE;
            totalDeposits += deposit;
            MarketDriverHarness.fund(marketDriver, usdc, bob, bobNft, vaultId, Side.No, RATE, deposit);
        }

        vm.warp(block.timestamp + CYCLE);
        vm.prank(steward);
        stewardRegistry.resolveVault(vaultId, Vault.Outcome.Yes);
        vault.collect(vaultId);
        vm.warp(block.timestamp + CYCLE * 3);
        vault.collect(vaultId);

        totalStopAllRefunds += _stopAllRefund(alice, aliceNft);
        totalStopAllRefunds += _stopAllRefund(bob, bobNft);

        vm.prank(alice);
        totalWithdraws += marketDriver.withdraw(aliceNft, vaultId, address(0));
        vm.prank(bob);
        totalWithdraws += marketDriver.withdraw(bobNft, vaultId, address(0));

        vault.collect(vaultId);
        vm.prank(alice);
        totalWithdraws += marketDriver.withdraw(aliceNft, vaultId, address(0));
        vm.prank(bob);
        totalWithdraws += marketDriver.withdraw(bobNft, vaultId, address(0));

        vm.prank(VaultDriverHarness.SEED_CREATOR);
        totalWithdraws += vaultDriver.withdraw(vaultId);

        vaultDriver.harvest(vaultId, Side.Yes);
        vaultDriver.harvest(vaultId, Side.No);
        vault.collect(vaultId);

        vm.prank(VaultDriverHarness.SEED_CREATOR);
        totalWithdraws += vaultDriver.withdraw(vaultId);

        uint256 vaultRemainder = usdc.balanceOf(address(vault));
        uint256 dripsRemainder = usdc.balanceOf(address(drips));
        assertLe(vaultRemainder + dripsRemainder, 2, "negligible residual dust");
        assertEq(
            totalDeposits,
            treasury.totalSkimmed() + totalStopAllRefunds + totalWithdraws + vaultRemainder + dripsRemainder,
            "conservation: deposits == skim + refunds + withdrawals + dust"
        );
    }

    /// Regression for the live stranding bug. A top-up that lands AFTER a lane ran dry while the Board
    /// was merely BEHIND (idle chain: nothing poked `advance` since maxEnd passed, so `depleted` still
    /// reads false on-chain) must re-fund the lane, or the top-up's Drips delivery is booked nowhere and
    /// strands in the Vault at resolution. Sequence: fund → dry-without-advancing → setLanes top-up →
    /// resolve YES → collect. Pre-fix this left ~`d2` permanently unclaimable in the Vault.
    function test_topUpAfterDryWhileBoardBehind_doesNotStrand() public {
        uint256 d1 = 4 * RATE; // 4s of runway -> Alice's lane dries at t=START+4
        uint256 d2 = 4 * RATE; // the top-up that pre-fix stranded

        // Alice funds YES; her lane runs dry at t=START+4.
        MarketDriverHarness.fund(marketDriver, usdc, alice, aliceNft, vaultId, Side.Yes, RATE, d1);

        // Idle PAST her maxEnd without poking advance — the Board stays behind, so `depleted` reads
        // false on-chain even though the deposit is already spent. This is the exact trigger.
        vm.warp(START + 6);
        assertEq(marketDriver.laneCount(aliceNft), 1, "lane still tracked pre-topup");

        // Declarative top-up. Pre-fix: diffs to a no-op (depleted==false), skips onFund, and
        // refreshMaxEnds no-ops on the now-depleting lane -> d2's delivery is booked nowhere.
        usdc.mint(alice, d2);
        vm.startPrank(alice);
        usdc.approve(address(marketDriver), d2);
        MarketDriver.Lane[] memory lanes = new MarketDriver.Lane[](1);
        lanes[0] = MarketDriver.Lane({vaultId: vaultId, side: Side.Yes, rate: RATE});
        marketDriver.setLanes(aliceNft, lanes, d2);
        vm.stopPrank();

        // Idle past the new maxEnd (START+10) and the seed maxEnd (START+10), then resolve YES.
        vm.warp(START + 13);
        vm.prank(steward);
        stewardRegistry.resolveVault(vaultId, Vault.Outcome.Yes);

        // Settle: full collect + cycle-complete harvest, then winners pull (Alice + the seed creator).
        vault.collect(vaultId);
        vm.warp(block.timestamp + CYCLE * 2);
        vault.collect(vaultId);
        vaultDriver.harvest(vaultId, Side.Yes);
        vaultDriver.harvest(vaultId, Side.No);
        vault.collect(vaultId);

        uint256 withdrawn;
        vm.prank(alice);
        withdrawn += marketDriver.withdraw(aliceNft, vaultId, address(0));
        vm.prank(VaultDriverHarness.SEED_CREATOR);
        withdrawn += vaultDriver.withdraw(vaultId);

        // Drain the cycle tail and re-pull, mirroring the proven settle path.
        vaultDriver.harvest(vaultId, Side.Yes);
        vault.collect(vaultId);
        vm.prank(alice);
        withdrawn += marketDriver.withdraw(aliceNft, vaultId, address(0));
        vm.prank(VaultDriverHarness.SEED_CREATOR);
        withdrawn += vaultDriver.withdraw(vaultId);

        // Every dollar delivered (seed 10s + Alice 4s + 4s) is fully streamed before resolution.
        uint256 delivered = CREATOR_SEED + d1 + d2;
        uint256 vaultRemainder = usdc.balanceOf(address(vault));
        uint256 dripsRemainder = usdc.balanceOf(address(drips));

        // Nothing strands (pre-fix this was ~d2), AND the delivered top-up reached the winners.
        assertLe(vaultRemainder + dripsRemainder, 2, "top-up delivery stranded in Vault");
        assertGe(withdrawn, delivered - 2, "winners did not receive all delivered USDC");
        assertEq(delivered, withdrawn + vaultRemainder + dripsRemainder, "conservation");
    }

    function _stopAllRefund(address who, uint256 tokenId) internal returns (uint256 refunded) {
        if (marketDriver.laneCount(tokenId) == 0) return 0;
        uint256 before = usdc.balanceOf(who);
        vm.prank(who);
        marketDriver.stopAll(tokenId, address(0));
        refunded = usdc.balanceOf(who) - before;
    }
}
