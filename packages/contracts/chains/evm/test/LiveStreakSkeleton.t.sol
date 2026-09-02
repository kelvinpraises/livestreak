// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MarketRegistry} from "../solidity/registries/MarketRegistry.sol";
import {VaultDriver} from "../solidity/streaming/drivers/VaultDriver.sol";
import {Vault} from "../solidity/vault/Vault.sol";
import {Side} from "../solidity/vault/Side.sol";
import {LvstToken} from "../solidity/treasury/LvstToken.sol";
import {StewardRegistry} from "../solidity/steward/StewardRegistry.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {ProtocolWire} from "./helpers/ProtocolWire.sol";
import {VaultDriverHarness} from "./helpers/VaultDriverHarness.sol";

/// @notice Skeleton coverage for market/vault registry, permissionless vault creation,
/// and steward hot/dispute writes. Funding + pricing in VaultBoard; treasury in Treasury.t.sol.
contract LiveStreakSkeletonTest is Test {
    MarketRegistry internal marketRegistry;
    Vault internal vault;
    VaultDriver internal vaultDriver;
    LvstToken internal lvstToken;
    StewardRegistry internal stewardRegistry;
    MockUSDC internal usdc;

    uint256 internal constant RATE = 1_000_000;
    uint256 internal constant SEED = 10 * RATE;

    address internal owner = makeAddr("owner");
    address internal creator = makeAddr("creator");
    address internal stranger = makeAddr("stranger");
    address internal steward = makeAddr("steward");

    function setUp() public {
        usdc = new MockUSDC();
        ProtocolWire.Core memory core = ProtocolWire.deployCore(owner, IERC20(address(usdc)));
        marketRegistry = core.marketRegistry;
        vault = core.vault;
        lvstToken = core.lvstToken;
        stewardRegistry = core.stewardRegistry;

        ProtocolWire.Streaming memory streaming = ProtocolWire.deployStreaming(owner, vault, usdc, 10);
        streaming = ProtocolWire.wireAll(owner, core, streaming);
        vaultDriver = core.vaultDriver;

        vm.startPrank(owner);
        stewardRegistry.registerSteward(steward);
        stewardRegistry.setDefaultSteward(steward);
        vm.stopPrank();
    }

    function _stewardVault() internal returns (bytes32 vaultId) {
        bytes32 marketId = marketRegistry.registerMarket("Steward stream", bytes32("steward"));
        vaultId = VaultDriverHarness.bondVault(vaultDriver, usdc, marketId, "Steward vault?", Side.Yes);
    }

    function test_registerMarket_assignsDeterministicMarketId() public {
        bytes32 streamId = bytes32("stream-1");
        bytes32 expected = marketRegistry.computeMarketId(address(this), streamId);

        bytes32 marketId = marketRegistry.registerMarket("Derby stream", streamId);

        assertEq(marketId, expected);
        assertEq(marketRegistry.marketCount(), 1);
        assertEq(marketRegistry.marketIdAt(0), marketId);
        assertEq(marketRegistry.getMarket(marketId).creator, address(this));
    }

    function test_registerMarket_sameStreamIdTwice_reverts() public {
        bytes32 streamId = bytes32("stream-1");
        marketRegistry.registerMarket("Derby stream", streamId);

        vm.expectRevert("MarketRegistry: market exists");
        marketRegistry.registerMarket("Derby stream again", streamId);
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

        bytes32 vaultA =
            VaultDriverHarness.createVault(vaultDriver, usdc, creator, marketA, "Question A", Side.Yes, RATE, SEED);
        bytes32 vaultB =
            VaultDriverHarness.createVault(vaultDriver, usdc, stranger, marketB, "Question B", Side.No, RATE, SEED);

        bytes32[] memory vaultsA = marketRegistry.getVaultIds(marketA);
        bytes32[] memory vaultsB = marketRegistry.getVaultIds(marketB);

        assertEq(vaultsA.length, 1);
        assertEq(vaultsB.length, 1);
        assertEq(vaultsA[0], vaultA);
        assertEq(vaultsB[0], vaultB);
        assertTrue(vaultA != vaultB);
    }

    function test_anyoneCanCreateVaultWithBond() public {
        bytes32 marketId = marketRegistry.registerMarket("Derby stream", bytes32("stream-1"));

        bytes32 vaultId = VaultDriverHarness.createVault(
            vaultDriver, usdc, stranger, marketId, "Next goal before 70'", Side.Yes, RATE, SEED
        );
        assertTrue(vault.vaultExists(vaultId));
        assertEq(vault.getVault(vaultId).creator, stranger);
    }

    function test_createVaultWithoutBond_reverts() public {
        bytes32 marketId = marketRegistry.registerMarket("Derby stream", bytes32("stream-1"));

        vm.prank(stranger);
        vm.expectRevert("VaultDriver: bad deposit");
        vaultDriver.createVault(marketId, "No bond", Side.Yes, RATE, 0);
    }

    function test_createVaultUnderMissingMarket_reverts() public {
        usdc.mint(creator, SEED);
        vm.startPrank(creator);
        usdc.approve(address(vaultDriver), SEED);
        vm.expectRevert("VaultDriver: unknown market");
        vaultDriver.createVault(bytes32(uint256(99)), "Ghost vault", Side.Yes, RATE, SEED);
        vm.stopPrank();
    }

    function test_steward_unauthorizedHotWrite_reverts() public {
        bytes32 vaultId = _stewardVault();
        vm.prank(stranger);
        vm.expectRevert("StewardRegistry: not market steward");
        stewardRegistry.triggerHot(vaultId, StewardRegistry.Severity.Hot, block.timestamp + 1 hours, bytes32("reason"));
    }

    function test_steward_authorizedHotWrite_succeeds() public {
        bytes32 vaultId = _stewardVault();
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
        bytes32 vaultId = _stewardVault();
        vm.prank(stranger);
        vm.expectRevert("StewardRegistry: not market steward");
        stewardRegistry.openDispute(vaultId, block.timestamp + 1 hours, bytes32("proof"));
    }

    function test_steward_authorizedDisputeWrite_succeeds() public {
        bytes32 vaultId = _stewardVault();
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
