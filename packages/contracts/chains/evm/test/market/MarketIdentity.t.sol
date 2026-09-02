// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {MarketRegistry} from "../../solidity/registries/MarketRegistry.sol";
import {VaultDriver} from "../../solidity/streaming/drivers/VaultDriver.sol";
import {Vault} from "../../solidity/vault/Vault.sol";
import {Side} from "../../solidity/vault/Side.sol";
import {Protocol} from "../../solidity/Protocol.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {ProtocolWire} from "../helpers/ProtocolWire.sol";
import {VaultDriverHarness} from "../helpers/VaultDriverHarness.sol";

contract MarketIdentityTest is Test {
    MarketRegistry internal marketRegistry;
    VaultDriver internal vaultDriver;
    Vault internal vault;
    MockUSDC internal usdc;

    uint256 internal constant RATE = 1_000_000;
    uint256 internal constant SEED = 10 * RATE;

    Protocol internal protocol;

    address internal owner = makeAddr("owner");
    address internal observer = makeAddr("observer");
    address internal attacker = makeAddr("attacker");
    address internal creator = makeAddr("creator");
    address internal stranger = makeAddr("stranger");

    address internal constant GOLDEN_OBSERVER = address(0xCA);
    bytes32 internal constant GOLDEN_STREAM_ID = 0x0000000000000000000000000000000000000000000000000000000000000042;
    bytes32 internal constant GOLDEN_MARKET_ID = 0xa9a8e72f956e612f800b6d705a3d5d085e655010f8c6ebec48299831c7677181;

    function setUp() public {
        usdc = new MockUSDC();
        ProtocolWire.Core memory core = ProtocolWire.deployCore(owner, IERC20(address(usdc)));
        protocol = core.protocol;
        marketRegistry = core.marketRegistry;
        vault = core.vault;

        ProtocolWire.Streaming memory streaming = ProtocolWire.deployStreaming(owner, vault, usdc, 10);
        streaming = ProtocolWire.wireAll(owner, core, streaming);
        vaultDriver = core.vaultDriver;
    }

    function test_registerMarket_returnsComputeMarketId() public {
        bytes32 streamId = bytes32("stream-alpha");
        vm.prank(observer);
        bytes32 marketId = marketRegistry.registerMarket("Derby stream", streamId);

        assertEq(marketId, marketRegistry.computeMarketId(observer, streamId));
    }

    function test_goldenVector_computeMarketId() public view {
        assertEq(marketRegistry.computeMarketId(GOLDEN_OBSERVER, GOLDEN_STREAM_ID), GOLDEN_MARKET_ID);
    }

    function test_goldenVector_registerMarket() public {
        vm.prank(GOLDEN_OBSERVER);
        bytes32 marketId = marketRegistry.registerMarket("Golden title", GOLDEN_STREAM_ID);
        assertEq(marketId, GOLDEN_MARKET_ID);
    }

    function test_storedMarketData_matchesRegistration() public {
        bytes32 streamId = bytes32("stream-beta");
        string memory title = "Stored title";

        vm.warp(1_700_000_000);
        vm.prank(observer);
        bytes32 marketId = marketRegistry.registerMarket(title, streamId);

        MarketRegistry.MarketData memory data = marketRegistry.getMarket(marketId);
        assertEq(data.id, marketId);
        assertEq(data.title, title);
        assertEq(data.streamId, streamId);
        assertEq(data.creator, observer);
        assertGt(data.createdAt, 0);
        assertTrue(data.exists);
    }

    function test_eventMarketRegistered_emitsExactValues() public {
        bytes32 streamId = bytes32("stream-gamma");
        string memory title = "Event title";

        vm.expectEmit(true, true, true, true, address(marketRegistry));
        emit MarketRegistry.MarketRegistered(
            marketRegistry.computeMarketId(observer, streamId), observer, streamId, title
        );
        vm.prank(observer);
        marketRegistry.registerMarket(title, streamId);
    }

    function test_sameCallerSameStreamId_secondRegistrationReverts() public {
        bytes32 streamId = bytes32("stream-dup");

        vm.startPrank(observer);
        marketRegistry.registerMarket("First", streamId);
        vm.expectRevert("MarketRegistry: market exists");
        marketRegistry.registerMarket("Second", streamId);
        vm.stopPrank();
    }

    function test_sameCallerDifferentStreamIds_bothStored() public {
        bytes32 streamA = bytes32("stream-a");
        bytes32 streamB = bytes32("stream-b");

        vm.startPrank(observer);
        bytes32 marketA = marketRegistry.registerMarket("Title A", streamA);
        bytes32 marketB = marketRegistry.registerMarket("Title B", streamB);
        vm.stopPrank();

        assertTrue(marketA != marketB);
        assertTrue(marketRegistry.marketExists(marketA));
        assertTrue(marketRegistry.marketExists(marketB));
        assertEq(marketRegistry.getMarket(marketA).streamId, streamA);
        assertEq(marketRegistry.getMarket(marketB).streamId, streamB);
    }

    function test_differentCallersSameStreamId_bothSucceedDistinctKeys() public {
        bytes32 streamId = bytes32("shared-stream");

        vm.prank(attacker);
        bytes32 attackerMarket = marketRegistry.registerMarket("Attacker title", streamId);

        vm.prank(observer);
        bytes32 observerMarket = marketRegistry.registerMarket("Observer title", streamId);

        assertTrue(attackerMarket != observerMarket);
        assertEq(attackerMarket, marketRegistry.computeMarketId(attacker, streamId));
        assertEq(observerMarket, marketRegistry.computeMarketId(observer, streamId));
        assertEq(marketRegistry.getMarket(attackerMarket).creator, attacker);
        assertEq(marketRegistry.getMarket(observerMarket).creator, observer);
        assertEq(marketRegistry.getMarket(observerMarket).title, "Observer title");
    }

    function test_frontRunObserverCannotBlockOrAlterObserverMarket() public {
        bytes32 streamId = bytes32("front-run-stream");
        string memory observerTitle = "Legitimate observer market";

        vm.prank(attacker);
        bytes32 attackerMarket = marketRegistry.registerMarket("Squatter title", streamId);
        assertEq(marketRegistry.getMarket(attackerMarket).creator, attacker);

        vm.prank(observer);
        bytes32 observerMarket = marketRegistry.registerMarket(observerTitle, streamId);

        assertEq(observerMarket, marketRegistry.computeMarketId(observer, streamId));
        assertTrue(observerMarket != attackerMarket);
        assertEq(marketRegistry.getMarket(observerMarket).creator, observer);
        assertEq(marketRegistry.getMarket(observerMarket).title, observerTitle);
        assertEq(marketRegistry.getMarket(attackerMarket).title, "Squatter title");
    }

    function test_callerCannotWriteAnotherObserversMarketKey() public {
        bytes32 streamId = bytes32("unspoofable-stream");
        bytes32 observerKey = marketRegistry.computeMarketId(observer, streamId);

        vm.prank(attacker);
        bytes32 attackerKey = marketRegistry.registerMarket("Attacker only", streamId);
        assertEq(attackerKey, marketRegistry.computeMarketId(attacker, streamId));
        assertTrue(attackerKey != observerKey);
        assertFalse(marketRegistry.marketExists(observerKey));

        vm.prank(observer);
        bytes32 created = marketRegistry.registerMarket("Observer owns key", streamId);
        assertEq(created, observerKey);
        assertEq(marketRegistry.getMarket(observerKey).creator, observer);
    }

    function test_attackerCannotOverwriteExistingMarket_includingOwn() public {
        bytes32 streamId = bytes32("no-overwrite");

        vm.startPrank(attacker);
        marketRegistry.registerMarket("First", streamId);
        vm.expectRevert("MarketRegistry: market exists");
        marketRegistry.registerMarket("Overwrite attempt", streamId);
        vm.stopPrank();
    }

    function test_emptyTitle_reverts() public {
        vm.prank(observer);
        vm.expectRevert("MarketRegistry: empty title");
        marketRegistry.registerMarket("", bytes32("stream"));
    }

    function test_zeroStreamId_reverts() public {
        vm.prank(observer);
        vm.expectRevert("MarketRegistry: zero streamId");
        marketRegistry.registerMarket("Title", bytes32(0));
    }

    function test_arbitraryLongUnicodeTitle_storedVerbatim() public {
        string memory title = unicode"Long title 🎥 with 多字节 chars and punctuation!!!";
        bytes32 streamId = bytes32("unicode-stream");

        vm.prank(observer);
        bytes32 marketId = marketRegistry.registerMarket(title, streamId);

        assertEq(marketRegistry.getMarket(marketId).title, title);
        assertEq(marketRegistry.getMarket(marketId).creator, observer);
    }

    function test_getMarket_unknownId_reverts_marketExistsFalse() public {
        bytes32 unknown = bytes32(uint256(99));
        assertFalse(marketRegistry.marketExists(unknown));

        vm.expectRevert("MarketRegistry: unknown market");
        marketRegistry.getMarket(unknown);
    }

    function test_enumeration_afterSeveralRegistrations() public {
        bytes32 stream1 = bytes32("enum-1");
        bytes32 stream2 = bytes32("enum-2");
        bytes32 stream3 = bytes32("enum-3");

        vm.startPrank(observer);
        bytes32 m1 = marketRegistry.registerMarket("One", stream1);
        bytes32 m2 = marketRegistry.registerMarket("Two", stream2);
        vm.stopPrank();

        vm.prank(attacker);
        bytes32 m3 = marketRegistry.registerMarket("Three", stream3);

        assertEq(marketRegistry.marketCount(), 3);
        assertEq(marketRegistry.marketIdAt(0), m1);
        assertEq(marketRegistry.marketIdAt(1), m2);
        assertEq(marketRegistry.marketIdAt(2), m3);
    }

    function test_addVault_vaultDriverGatedOnComputedMarketId() public {
        bytes32 streamId = bytes32("vault-stream");

        vm.prank(observer);
        bytes32 marketId = marketRegistry.registerMarket("Vault market", streamId);

        vm.prank(stranger);
        vm.expectRevert("MarketRegistry: not vault driver");
        marketRegistry.addVault(marketId, bytes32("vault-1"));

        vm.prank(address(vaultDriver));
        vm.expectRevert("MarketRegistry: unknown market");
        marketRegistry.addVault(bytes32(uint256(999)), bytes32("vault-ghost"));

        bytes32 vaultId = VaultDriverHarness.bondVault(vaultDriver, usdc, marketId, "Question?", Side.Yes);

        bytes32[] memory vaultIds = marketRegistry.getVaultIds(marketId);
        assertEq(vaultIds.length, 1);
        assertEq(vaultIds[0], vaultId);
    }

    function test_protocolVaultDriver_onlyOwner() public {
        Protocol fresh = new Protocol(owner);

        vm.prank(stranger);
        vm.expectRevert();
        fresh.setVaultDriver(address(vaultDriver));

        vm.prank(owner);
        fresh.setVaultDriver(address(vaultDriver));
        assertEq(fresh.vaultDriver(), address(vaultDriver));
    }

    function test_marketIdRoundTripsFromEventAndGetMarket() public {
        bytes32 streamId = bytes32("round-trip");
        string memory title = "Round trip";

        vm.recordLogs();
        vm.prank(observer);
        bytes32 marketId = marketRegistry.registerMarket(title, streamId);

        Vm.Log[] memory entries = vm.getRecordedLogs();
        assertEq(entries.length, 1);
        assertEq(entries[0].topics[1], marketId);
        assertEq(address(uint160(uint256(entries[0].topics[2]))), observer);
        assertEq(entries[0].topics[3], streamId);

        MarketRegistry.MarketData memory data = marketRegistry.getMarket(marketId);
        assertEq(data.id, marketRegistry.computeMarketId(observer, streamId));
        assertEq(data.creator, observer);
        assertEq(data.streamId, streamId);
        assertEq(data.title, title);
    }

    function test_creatorIsAlwaysMsgSender() public {
        bytes32 streamId = bytes32("creator-check");

        vm.prank(observer);
        bytes32 observerMarket = marketRegistry.registerMarket("Observer", streamId);
        assertEq(marketRegistry.getMarket(observerMarket).creator, observer);

        vm.prank(attacker);
        bytes32 attackerMarket = marketRegistry.registerMarket("Attacker", streamId);
        assertEq(marketRegistry.getMarket(attackerMarket).creator, attacker);
    }

    function test_fuzz_registrationByANeverBlocksB(
        address callerA,
        address callerB,
        bytes32 streamIdA,
        bytes32 streamIdB
    ) public {
        vm.assume(callerA != address(0) && callerB != address(0));
        vm.assume(callerA != callerB);
        vm.assume(streamIdA != bytes32(0) && streamIdB != bytes32(0));

        vm.prank(callerA);
        bytes32 marketA = marketRegistry.registerMarket("A", streamIdA);

        vm.prank(callerB);
        bytes32 marketB = marketRegistry.registerMarket("B", streamIdB);

        assertTrue(marketRegistry.marketExists(marketA));
        assertTrue(marketRegistry.marketExists(marketB));
        assertEq(marketRegistry.getMarket(marketA).creator, callerA);
        assertEq(marketRegistry.getMarket(marketB).creator, callerB);
    }
}
