// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DripsStreaming} from "../../../solidity/streaming/DripsStreaming.sol";
import {VaultDriver} from "../../../solidity/streaming/drivers/VaultDriver.sol";
import {MarketDriver} from "../../../solidity/streaming/drivers/MarketDriver.sol";
import {Vault} from "../../../solidity/vault/Vault.sol";
import {Side} from "../../../solidity/vault/Side.sol";
import {MarketRegistry} from "../../../solidity/registries/MarketRegistry.sol";
import {StewardRegistry} from "../../../solidity/steward/StewardRegistry.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../../mocks/MockUSDC.sol";
import {ProtocolWire} from "../../helpers/ProtocolWire.sol";
import {MarketDriverHarness} from "../../helpers/MarketDriverHarness.sol";
import {VaultDriverHarness} from "../../helpers/VaultDriverHarness.sol";

/// @notice VaultDriver: permissionless bonded vault creation + seed position lifecycle.
contract VaultDriverTest is Test {
    uint32 internal constant CYCLE = 10;
    uint256 internal constant START = 100;
    uint256 internal constant RATE = 1_000_000;
    uint256 internal constant SEED_DEPOSIT = 10 * RATE;

    DripsStreaming internal drips;
    MockUSDC internal usdc;
    Vault internal vault;
    VaultDriver internal vaultDriver;
    MarketDriver internal marketDriver;
    MarketRegistry internal marketRegistry;
    StewardRegistry internal stewardRegistry;

    bytes32 internal marketId;
    address internal creator = makeAddr("creator");
    address internal stranger = makeAddr("stranger");
    address internal steward = makeAddr("steward");

    function setUp() public {
        vm.warp(START);

        usdc = new MockUSDC();
        ProtocolWire.Core memory core = ProtocolWire.deployCore(address(this), IERC20(address(usdc)));
        marketRegistry = core.marketRegistry;
        vault = core.vault;
        stewardRegistry = core.stewardRegistry;

        ProtocolWire.Streaming memory streaming = ProtocolWire.deployStreaming(address(this), vault, usdc, CYCLE);
        streaming = ProtocolWire.wireAll(address(this), core, streaming);
        drips = streaming.drips;
        marketDriver = streaming.marketDriver;
        vaultDriver = core.vaultDriver;

        stewardRegistry.registerSteward(steward);
        stewardRegistry.setDefaultSteward(steward);
        marketId = marketRegistry.registerMarket("m", bytes32("s"));
    }

    function test_permissionlessCreate_anyAddress() public {
        bytes32 vaultId =
            VaultDriverHarness.createVault(vaultDriver, usdc, stranger, marketId, "Q?", Side.Yes, RATE, SEED_DEPOSIT);

        assertTrue(vault.vaultExists(vaultId));
        Vault.VaultData memory data = vault.getVault(vaultId);
        assertEq(data.creator, stranger);
        assertEq(data.marketId, marketId);

        bytes32[] memory vaultIds = marketRegistry.getVaultIds(marketId);
        assertEq(vaultIds.length, 1);
        assertEq(vaultIds[0], vaultId);
    }

    function test_seedOpensRealPosition() public {
        bytes32 vaultId =
            VaultDriverHarness.createVault(vaultDriver, usdc, creator, marketId, "Q?", Side.Yes, RATE, SEED_DEPOSIT);

        uint256 account = vaultDriver.seedAccount(creator, vaultId);
        (uint256 rate,,, uint32 maxEnd,) = vault.getPosition(vaultId, Side.Yes, account);
        assertEq(rate, RATE);
        assertGt(maxEnd, uint32(START));

        vm.warp(START + 5);
        vault.advance(vaultId, Side.Yes, 64);
        assertGt(vault.pendingShares(vaultId, Side.Yes, account), 0, "seed accrues shares");
    }

    function test_zeroRate_reverts() public {
        usdc.mint(creator, SEED_DEPOSIT);
        vm.startPrank(creator);
        usdc.approve(address(vaultDriver), SEED_DEPOSIT);
        vm.expectRevert("VaultDriver: zero rate");
        vaultDriver.createVault(marketId, "Q?", Side.Yes, 0, SEED_DEPOSIT);
        vm.stopPrank();
    }

    function test_zeroDeposit_reverts() public {
        vm.prank(creator);
        vm.expectRevert("VaultDriver: bad deposit");
        vaultDriver.createVault(marketId, "Q?", Side.Yes, RATE, 0);
    }

    function test_unknownMarket_reverts() public {
        usdc.mint(creator, SEED_DEPOSIT);
        vm.startPrank(creator);
        usdc.approve(address(vaultDriver), SEED_DEPOSIT);
        vm.expectRevert("VaultDriver: unknown market");
        vaultDriver.createVault(bytes32(uint256(99)), "Q?", Side.Yes, RATE, SEED_DEPOSIT);
        vm.stopPrank();
    }

    function test_emptyQuestion_reverts() public {
        usdc.mint(creator, SEED_DEPOSIT);
        vm.startPrank(creator);
        usdc.approve(address(vaultDriver), SEED_DEPOSIT);
        vm.expectRevert("Vault: empty question");
        vaultDriver.createVault(marketId, "", Side.Yes, RATE, SEED_DEPOSIT);
        vm.stopPrank();
    }

    function test_seedRecoverableViaWithdraw() public {
        bytes32 vaultId =
            VaultDriverHarness.createVault(vaultDriver, usdc, creator, marketId, "Q?", Side.Yes, RATE, SEED_DEPOSIT);

        address bob = makeAddr("bob");
        uint256 bobNft = MarketDriverHarness.mint(marketDriver, bob, marketId);
        MarketDriverHarness.fund(marketDriver, usdc, bob, bobNft, vaultId, Side.No, RATE, SEED_DEPOSIT);

        vm.warp(START + 20);
        vm.prank(steward);
        stewardRegistry.resolveVault(vaultId, Vault.Outcome.Yes);
        vault.collect(vaultId);
        vm.warp(block.timestamp + CYCLE);

        uint256 before = usdc.balanceOf(creator);
        vm.prank(creator);
        uint256 paid = vaultDriver.withdraw(vaultId);
        assertGt(paid, 0, "seed creator recovers winnings");
        assertEq(usdc.balanceOf(creator) - before, paid);
    }

    function test_stopSeed_closesLane() public {
        bytes32 vaultId =
            VaultDriverHarness.createVault(vaultDriver, usdc, creator, marketId, "Q?", Side.No, RATE, SEED_DEPOSIT);

        vm.warp(START + 5);
        vm.prank(creator);
        vaultDriver.stopSeed(vaultId);

        uint256 account = vaultDriver.seedAccount(creator, vaultId);
        (uint256 rate,,,,) = vault.getPosition(vaultId, Side.No, account);
        assertEq(rate, 0, "board lane cleared");
    }
}
