// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {BookmakerRegistry} from "../src/bookmaker/BookmakerRegistry.sol";
import {MarketRegistry} from "../src/market/MarketRegistry.sol";
import {Vault} from "../src/vault/Vault.sol";
import {VaultFactory} from "../src/vault/VaultFactory.sol";
import {LvstToken} from "../src/token/LvstToken.sol";
import {StewardRegistry} from "../src/steward/StewardRegistry.sol";
import {Side} from "../src/vault/Side.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Skeleton coverage for the non-funding surfaces: market/vault registry, bookmaker gating,
/// and steward hot/dispute writes. Funding + pricing is proven in test/vault/VaultBoard.t.sol, and
/// the LVST house token (loss-mint, skim, staking, dividends) in test/token/LvstToken.t.sol.
contract LiveStreakSkeletonTest is Test {
    BookmakerRegistry internal bookmakerRegistry;
    MarketRegistry internal marketRegistry;
    Vault internal vault;
    VaultFactory internal vaultFactory;
    LvstToken internal lvstToken;
    StewardRegistry internal stewardRegistry;

    address internal owner = makeAddr("owner");
    address internal bookmaker = makeAddr("bookmaker");
    address internal stranger = makeAddr("stranger");
    address internal user = makeAddr("user");
    address internal steward = makeAddr("steward");

    function setUp() public {
        vm.startPrank(owner);
        bookmakerRegistry = new BookmakerRegistry(owner);
        marketRegistry = new MarketRegistry(owner);
        vault = new Vault();
        vaultFactory = new VaultFactory(bookmakerRegistry, marketRegistry, vault);
        lvstToken = new LvstToken(owner, IERC20(address(new MockUSDC())));
        stewardRegistry = new StewardRegistry(owner);

        vault.setFactory(address(vaultFactory));
        marketRegistry.setVaultFactory(address(vaultFactory));
        bookmakerRegistry.setBookmaker(bookmaker, true);
        stewardRegistry.registerSteward(steward);
        vm.stopPrank();
    }

    function test_registerMarket_assignsSequentialMarketId() public {
        bytes32 first = marketRegistry.registerMarket("Derby stream", bytes32("stream-1"));
        bytes32 second = marketRegistry.registerMarket("Derby stream", bytes32("stream-1"));

        assertEq(first, bytes32(uint256(1)));
        assertEq(second, bytes32(uint256(2)));
        assertTrue(first != second);
        assertEq(marketRegistry.marketCount(), 2);
        assertEq(marketRegistry.marketIdAt(0), first);
        assertEq(marketRegistry.marketIdAt(1), second);
    }

    function test_marketExists_isExplicit() public {
        assertFalse(marketRegistry.marketExists(bytes32(uint256(1))));

        bytes32 marketId = marketRegistry.registerMarket("Derby stream", bytes32("stream-1"));

        assertTrue(marketRegistry.marketExists(marketId));
        assertFalse(marketRegistry.marketExists(bytes32(uint256(99))));
    }

    function test_getMarket_unknownMarket_reverts() public {
        vm.expectRevert("MarketRegistry: unknown market");
        marketRegistry.getMarket(bytes32(uint256(1)));
    }

    function test_vaultIndex_staysMarketScoped() public {
        bytes32 marketA = marketRegistry.registerMarket("Stream A", bytes32("a"));
        bytes32 marketB = marketRegistry.registerMarket("Stream B", bytes32("b"));

        vm.startPrank(bookmaker);
        bytes32 vaultA = vaultFactory.createVault(marketA, "Question A");
        bytes32 vaultB = vaultFactory.createVault(marketB, "Question B");
        vm.stopPrank();

        bytes32[] memory vaultsA = marketRegistry.getVaultIds(marketA);
        bytes32[] memory vaultsB = marketRegistry.getVaultIds(marketB);

        assertEq(vaultsA.length, 1);
        assertEq(vaultsB.length, 1);
        assertEq(vaultsA[0], vaultA);
        assertEq(vaultsB[0], vaultB);
        assertTrue(vaultA != vaultB);
    }

    function test_unauthorizedBookmakerCannotCreateVault() public {
        bytes32 marketId = marketRegistry.registerMarket("Derby stream", bytes32("stream-1"));

        vm.prank(stranger);
        vm.expectRevert("VaultFactory: not bookmaker");
        vaultFactory.createVault(marketId, "Next goal before 70'");
    }

    function test_ownerCanSetBookmakerAuthorization() public {
        bytes32 marketId = marketRegistry.registerMarket("Derby stream", bytes32("stream-1"));

        vm.prank(owner);
        bookmakerRegistry.setBookmaker(stranger, true);

        vm.prank(stranger);
        bytes32 vaultId = vaultFactory.createVault(marketId, "Authorized stranger vault");
        assertTrue(vault.vaultExists(vaultId));

        vm.prank(owner);
        bookmakerRegistry.setBookmaker(stranger, false);

        vm.prank(stranger);
        vm.expectRevert("VaultFactory: not bookmaker");
        vaultFactory.createVault(marketId, "Revoked stranger vault");
    }

    function test_authorizedBookmakerCanCreateVault() public {
        bytes32 marketId = marketRegistry.registerMarket("Derby stream", bytes32("stream-1"));

        vm.prank(bookmaker);
        bytes32 vaultId = vaultFactory.createVault(marketId, "Next goal before 70'");

        bytes32[] memory vaultIds = marketRegistry.getVaultIds(marketId);
        assertEq(vaultIds.length, 1);
        assertEq(vaultIds[0], vaultId);

        Vault.VaultData memory data = vault.getVault(vaultId);
        assertEq(data.marketId, marketId);
        assertEq(data.creator, bookmaker);
        assertEq(uint8(data.status), uint8(Vault.Status.Open));
    }

    function test_createVaultUnderMissingMarket_reverts() public {
        vm.prank(bookmaker);
        vm.expectRevert("VaultFactory: unknown market");
        vaultFactory.createVault(bytes32(uint256(99)), "Ghost vault");
    }

    function test_steward_unauthorizedHotWrite_reverts() public {
        vm.prank(stranger);
        vm.expectRevert("StewardRegistry: not steward");
        stewardRegistry.triggerHot(
            bytes32("vault"), StewardRegistry.Severity.Hot, block.timestamp + 1 hours, bytes32("reason")
        );
    }

    function test_steward_authorizedHotWrite_succeeds() public {
        bytes32 vaultId = bytes32("vault");
        bytes32 reason = bytes32("reason");

        vm.prank(steward);
        stewardRegistry.triggerHot(vaultId, StewardRegistry.Severity.Hot, block.timestamp + 1 hours, reason);

        (bool active,, StewardRegistry.Severity severity, bytes32 reasonHash) = stewardRegistry.vaultHotState(vaultId);
        assertTrue(active);
        assertEq(uint8(severity), uint8(StewardRegistry.Severity.Hot));
        assertEq(reasonHash, reason);

        vm.prank(steward);
        stewardRegistry.endHot(vaultId);

        (active,,,) = stewardRegistry.vaultHotState(vaultId);
        assertFalse(active);
    }

    function test_steward_unauthorizedDisputeWrite_reverts() public {
        vm.prank(stranger);
        vm.expectRevert("StewardRegistry: not steward");
        stewardRegistry.openDispute(bytes32("vault"), block.timestamp + 1 hours, bytes32("proof"));
    }

    function test_steward_authorizedDisputeWrite_succeeds() public {
        bytes32 vaultId = bytes32("vault");
        bytes32 proof = bytes32("proof");
        uint256 challengeUntil = block.timestamp + 1 hours;

        vm.prank(steward);
        stewardRegistry.openDispute(vaultId, challengeUntil, proof);

        (bool active, uint256 challengeUntilOut, bytes32 proofOut) = stewardRegistry.disputeState(vaultId);
        assertTrue(active);
        assertEq(challengeUntilOut, challengeUntil);
        assertEq(proofOut, proof);

        vm.prank(steward);
        stewardRegistry.closeDispute(vaultId);

        (active,,) = stewardRegistry.disputeState(vaultId);
        assertFalse(active);
    }
}
