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
        vaultDriver.createBoundVault(marketId, "Q?", Side.Yes, 0, SEED_DEPOSIT, bytes32(uint256(1)), uint32(block.timestamp + 365 days), bytes32(uint256(1)));
        vm.stopPrank();
    }

    function test_zeroDeposit_reverts() public {
        vm.prank(creator);
        vm.expectRevert("VaultDriver: bad deposit");
        vaultDriver.createBoundVault(marketId, "Q?", Side.Yes, RATE, 0, bytes32(uint256(1)), uint32(block.timestamp + 365 days), bytes32(uint256(1)));
    }

    function test_unknownMarket_reverts() public {
        usdc.mint(creator, SEED_DEPOSIT);
        vm.startPrank(creator);
        usdc.approve(address(vaultDriver), SEED_DEPOSIT);
        vm.expectRevert("VaultDriver: unknown market");
        vaultDriver.createBoundVault(bytes32(uint256(99)), "Q?", Side.Yes, RATE, SEED_DEPOSIT, bytes32(uint256(1)), uint32(block.timestamp + 365 days), bytes32(uint256(1)));
        vm.stopPrank();
    }

    function test_emptyQuestion_reverts() public {
        usdc.mint(creator, SEED_DEPOSIT);
        vm.startPrank(creator);
        usdc.approve(address(vaultDriver), SEED_DEPOSIT);
        vm.expectRevert("Vault: empty question");
        vaultDriver.createBoundVault(marketId, "", Side.Yes, RATE, SEED_DEPOSIT, bytes32(uint256(1)), uint32(block.timestamp + 365 days), bytes32(uint256(1)));
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

    function test_stopSeed_closesLaneAndRefundsUnspent() public {
        bytes32 vaultId =
            VaultDriverHarness.createVault(vaultDriver, usdc, creator, marketId, "Q?", Side.No, RATE, SEED_DEPOSIT);

        vm.warp(START + 5); // 5 of 10 USDC streamed at rate 1e6; ~5 USDC unspent
        uint256 before = usdc.balanceOf(creator);
        vm.prank(creator);
        uint256 refunded = vaultDriver.stopSeed(vaultId);

        uint256 account = vaultDriver.seedAccount(creator, vaultId);
        (uint256 rate,,,,) = vault.getPosition(vaultId, Side.No, account);
        assertEq(rate, 0, "board lane cleared");
        assertGt(refunded, 0, "unspent seed bond refunded");
        assertEq(usdc.balanceOf(creator) - before, refunded, "refund paid to the creator");
        assertApproxEqAbs(refunded, 5 * RATE, RATE, "roughly the unstreamed half of the bond");
    }

    function _bound(uint32 close, bytes32 op) internal returns (bytes32) {
        usdc.mint(creator, 50 * RATE);
        vm.startPrank(creator);
        usdc.approve(address(vaultDriver), 50 * RATE);
        bytes32 id = vaultDriver.createBoundVault(marketId, "Bound question", Side.Yes, RATE, 50 * RATE, bytes32(uint256(42)), close, op);
        vm.stopPrank();
        return id;
    }

    function test_boundCommitment_replayDoesNotSeedTwice_evenAfterClose() public {
        bytes32 op = bytes32(uint256(7));
        uint32 close = uint32(START + 10);
        bytes32 id = _bound(close, op);
        assertEq(vault.mandateCommitment(id), bytes32(uint256(42)));
        assertEq(vault.fundingClose(id), close);
        uint256 before = usdc.balanceOf(address(drips));
        vm.warp(close + 1);
        vm.prank(creator);
        bytes32 again = vaultDriver.createBoundVault(marketId,"Bound question",Side.Yes,RATE,50*RATE,bytes32(uint256(42)),close,op);
        assertEq(again,id);assertEq(usdc.balanceOf(address(drips)),before);
        vm.prank(creator);vm.expectRevert("VaultDriver: operation conflict");
        vaultDriver.createBoundVault(marketId,"Changed question",Side.Yes,RATE,50*RATE,bytes32(uint256(42)),close,op);
    }

    function test_boundClose_capsRealTokensAndShares_andRefundsUnspent() public {
        uint32 close=uint32(START+10);bytes32 id=_bound(close,bytes32(uint256(8)));
        uint256 nft=MarketDriverHarness.mint(marketDriver,stranger,marketId);
        MarketDriverHarness.fund(marketDriver,usdc,stranger,nft,id,Side.Yes,RATE,50*RATE);
        vm.warp(close);vault.advance(id,Side.Yes,type(uint256).max);
        (uint256 pool,,,)=vault.getBoard(id,Side.Yes);assertEq(pool,20*RATE);
        uint256 shares=vault.pendingShares(id,Side.Yes,nft);
        vm.warp(close+20);vault.advance(id,Side.Yes,type(uint256).max);
        assertEq(vault.pendingShares(id,Side.Yes,nft),shares);
        assertEq(vaultDriver.harvest(id,Side.Yes),20*RATE,"actual delivery matches Board cutoff");
        vm.prank(creator);assertEq(vaultDriver.stopSeed(id),40*RATE);
        vm.prank(stranger);vm.expectRevert("MarketDriver: funding closed");marketDriver.fund(nft,id,Side.No,RATE,RATE);
    }

    function test_noHashlessOrLateBoundCreation() public {
        vm.prank(creator);vm.expectRevert("VaultDriver: mandate required");vaultDriver.createVault(marketId,"legacy",Side.Yes,RATE,RATE);
        vm.prank(creator);vm.expectRevert("Vault: mandate required");vaultDriver.createBoundVault(marketId,"bad",Side.Yes,RATE,RATE,bytes32(0),uint32(START+10),bytes32(uint256(9)));
        vm.prank(creator);vm.expectRevert("Vault: funding closed");vaultDriver.createBoundVault(marketId,"late",Side.Yes,RATE,RATE,bytes32(uint256(1)),uint32(START),bytes32(uint256(10)));
    }

    function test_mixedDeadlines_preserveClosedLaneDuringSafeRemoval() public {
        bytes32 shortId=_bound(uint32(START+10),bytes32(uint256(11)));
        bytes32 longId=_bound(uint32(START+30),bytes32(uint256(12)));
        uint256 nft=MarketDriverHarness.mint(marketDriver,stranger,marketId);
        MarketDriverHarness.fund(marketDriver,usdc,stranger,nft,shortId,Side.Yes,RATE,50*RATE);
        MarketDriverHarness.fund(marketDriver,usdc,stranger,nft,longId,Side.No,RATE,50*RATE);
        (,,,uint32 shortEnd,)=vault.getPosition(shortId,Side.Yes,nft);assertEq(shortEnd,START+10);
        vm.warp(START+15);
        MarketDriver.Lane[] memory desired=new MarketDriver.Lane[](1);
        desired[0]=MarketDriver.Lane({vaultId:shortId,side:Side.Yes,rate:RATE});
        vm.prank(stranger);marketDriver.setLanes(nft,desired,0);
        vault.advance(shortId,Side.Yes,type(uint256).max);
        (uint256 pool,,,)=vault.getBoard(shortId,Side.Yes);assertEq(pool,20*RATE);
        vm.prank(stranger);vm.expectRevert("MarketDriver: funding closed");marketDriver.setLanes(nft,desired,RATE);
        vm.prank(stranger);marketDriver.stop(nft,shortId,Side.Yes);
        vm.warp(START+40);assertEq(vaultDriver.harvest(shortId,Side.Yes),20*RATE);
    }
}
