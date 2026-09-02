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

    function _stopAllRefund(address who, uint256 tokenId) internal returns (uint256 refunded) {
        if (marketDriver.laneCount(tokenId) == 0) return 0;
        uint256 before = usdc.balanceOf(who);
        vm.prank(who);
        marketDriver.stopAll(tokenId);
        refunded = usdc.balanceOf(who) - before;
    }
}
