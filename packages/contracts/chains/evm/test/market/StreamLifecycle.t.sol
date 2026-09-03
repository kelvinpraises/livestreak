// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MarketRegistry} from "../../solidity/registries/MarketRegistry.sol";
import {VaultDriver} from "../../solidity/streaming/drivers/VaultDriver.sol";
import {Vault} from "../../solidity/vault/Vault.sol";
import {Protocol} from "../../solidity/Protocol.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {ProtocolWire} from "../helpers/ProtocolWire.sol";

contract StreamLifecycleTest is Test {
    MarketRegistry internal marketRegistry;
    VaultDriver internal vaultDriver;
    Vault internal vault;
    MockUSDC internal usdc;
    Protocol internal protocol;

    address internal owner = makeAddr("owner");
    address internal creator = makeAddr("creator");
    address internal stranger = makeAddr("stranger");

    bytes32 internal marketId;
    string internal liveId = "Ci3uNXqA0ent7gRMjWSY7XfzDYl8GWFBtErU2gzZR3M"; // 43-char Walrus blobId
    string internal vodId = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"; // 59-char IPFS CIDv1
    string internal vodReviseId = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"; // 46-char IPFS CIDv0

    MarketRegistry.StorageScheme internal constant SCHEME_LIVE = MarketRegistry.StorageScheme.WalrusTestnet;

    function setUp() public {
        usdc = new MockUSDC();
        ProtocolWire.Core memory core = ProtocolWire.deployCore(owner, IERC20(address(usdc)));
        protocol = core.protocol;
        marketRegistry = core.marketRegistry;
        vault = core.vault;

        ProtocolWire.Streaming memory streaming = ProtocolWire.deployStreaming(owner, vault, usdc, 10);
        streaming = ProtocolWire.wireAll(owner, core, streaming);
        vaultDriver = core.vaultDriver;

        vm.prank(creator);
        marketId = marketRegistry.registerMarket("Stream market", bytes32("stream-lifecycle"));
    }

    function _stream(bytes32 mid) internal view returns (MarketRegistry.StreamState memory) {
        (
            MarketRegistry.StreamStatus status,
            MarketRegistry.StorageScheme scheme,
            string memory id,
            uint64 updatedAt,
            uint64 endedAt
        ) = marketRegistry.streamState(mid);
        return
            MarketRegistry.StreamState({status: status, scheme: scheme, id: id, updatedAt: updatedAt, endedAt: endedAt});
    }

    function test_goLive_setsLiveAndEmits() public {
        uint256 t0 = block.timestamp;

        vm.expectEmit(true, false, false, true, address(marketRegistry));
        emit MarketRegistry.StreamLive(marketId, SCHEME_LIVE, liveId, uint64(t0));
        vm.prank(creator);
        marketRegistry.goLive(marketId, SCHEME_LIVE, liveId);

        MarketRegistry.StreamState memory s = _stream(marketId);
        assertEq(uint8(s.status), uint8(MarketRegistry.StreamStatus.Live));
        assertEq(uint8(s.scheme), uint8(SCHEME_LIVE));
        assertEq(s.id, liveId);
        assertEq(s.updatedAt, uint64(t0));
        assertEq(s.endedAt, 0);
    }

    function test_goLive_nonCreatorReverts() public {
        vm.prank(stranger);
        vm.expectRevert("MarketRegistry: not creator");
        marketRegistry.goLive(marketId, SCHEME_LIVE, liveId);
    }

    function test_goLive_unknownMarketReverts() public {
        vm.prank(creator);
        vm.expectRevert("MarketRegistry: unknown market");
        marketRegistry.goLive(bytes32(uint256(999)), SCHEME_LIVE, liveId);
    }

    function test_goLive_emptyIdReverts() public {
        vm.prank(creator);
        vm.expectRevert("MarketRegistry: bad id length");
        marketRegistry.goLive(marketId, SCHEME_LIVE, "");
    }

    function test_goLive_tooLongIdReverts() public {
        string memory tooLong = new string(65); // 65 bytes > 64 cap
        vm.prank(creator);
        vm.expectRevert("MarketRegistry: bad id length");
        marketRegistry.goLive(marketId, SCHEME_LIVE, tooLong);
    }

    function test_goLive_whileLiveRepoints() public {
        string memory repointed = "arweave-repoint-txid-0001";

        vm.startPrank(creator);
        marketRegistry.goLive(marketId, MarketRegistry.StorageScheme.WalrusTestnet, liveId);
        marketRegistry.goLive(marketId, MarketRegistry.StorageScheme.Arweave, repointed);
        vm.stopPrank();

        MarketRegistry.StreamState memory s = _stream(marketId);
        assertEq(uint8(s.status), uint8(MarketRegistry.StreamStatus.Live));
        assertEq(uint8(s.scheme), uint8(MarketRegistry.StorageScheme.Arweave));
        assertEq(s.id, repointed);
    }

    function test_setEnded_fromLiveSetsEndedAndEmits() public {
        vm.prank(creator);
        marketRegistry.goLive(marketId, SCHEME_LIVE, liveId);

        uint256 t1 = block.timestamp;
        vm.expectEmit(true, false, false, true, address(marketRegistry));
        emit MarketRegistry.StreamEnded(marketId, SCHEME_LIVE, vodId, uint64(t1));
        vm.prank(creator);
        marketRegistry.setEnded(marketId, SCHEME_LIVE, vodId);

        MarketRegistry.StreamState memory s = _stream(marketId);
        assertEq(uint8(s.status), uint8(MarketRegistry.StreamStatus.Ended));
        assertEq(uint8(s.scheme), uint8(SCHEME_LIVE));
        assertEq(s.id, vodId);
        assertEq(s.endedAt, uint64(t1));
    }

    function test_setEnded_fromNoneReverts() public {
        vm.prank(creator);
        vm.expectRevert("MarketRegistry: not live");
        marketRegistry.setEnded(marketId, SCHEME_LIVE, vodId);
    }

    function test_setEnded_nonCreatorReverts() public {
        vm.prank(creator);
        marketRegistry.goLive(marketId, SCHEME_LIVE, liveId);

        vm.prank(stranger);
        vm.expectRevert("MarketRegistry: not creator");
        marketRegistry.setEnded(marketId, SCHEME_LIVE, vodId);
    }

    function test_setEnded_reviseWithinGrace_keepsEndedAt() public {
        uint256 t0 = 1_700_000_000;
        vm.warp(t0);

        vm.startPrank(creator);
        marketRegistry.goLive(marketId, SCHEME_LIVE, liveId);
        marketRegistry.setEnded(marketId, SCHEME_LIVE, vodId);
        vm.warp(t0 + 12 hours);
        marketRegistry.setEnded(marketId, MarketRegistry.StorageScheme.Arweave, vodReviseId);
        vm.stopPrank();

        MarketRegistry.StreamState memory s = _stream(marketId);
        assertEq(s.endedAt, uint64(t0));
        assertEq(uint8(s.scheme), uint8(MarketRegistry.StorageScheme.Arweave));
        assertEq(s.id, vodReviseId);
        assertFalse(marketRegistry.isLocked(marketId));
    }

    function test_setEnded_afterLockReverts() public {
        uint256 t0 = 1_700_000_000;
        vm.warp(t0);

        vm.startPrank(creator);
        marketRegistry.goLive(marketId, SCHEME_LIVE, liveId);
        marketRegistry.setEnded(marketId, SCHEME_LIVE, vodId);
        vm.warp(t0 + 25 hours);
        vm.expectRevert("MarketRegistry: stream locked");
        marketRegistry.setEnded(marketId, MarketRegistry.StorageScheme.Arweave, vodReviseId);
        vm.stopPrank();
    }

    function test_isLocked_boundary() public {
        uint256 t0 = 1_700_000_000;
        vm.warp(t0);

        vm.startPrank(creator);
        marketRegistry.goLive(marketId, SCHEME_LIVE, liveId);
        marketRegistry.setEnded(marketId, SCHEME_LIVE, vodId);
        vm.stopPrank();

        vm.warp(t0 + 1 days);
        assertFalse(marketRegistry.isLocked(marketId));

        vm.warp(t0 + 1 days + 1);
        assertTrue(marketRegistry.isLocked(marketId));
    }

    function test_goLive_afterEndedReverts() public {
        vm.startPrank(creator);
        marketRegistry.goLive(marketId, SCHEME_LIVE, liveId);
        marketRegistry.setEnded(marketId, SCHEME_LIVE, vodId);
        vm.expectRevert("MarketRegistry: stream ended");
        marketRegistry.goLive(marketId, SCHEME_LIVE, liveId);
        vm.stopPrank();
    }

    function test_goldenLifecycle() public {
        uint256 t0 = 1_700_000_000;
        vm.warp(t0);

        assertEq(uint8(_stream(marketId).status), uint8(MarketRegistry.StreamStatus.None));

        vm.prank(creator);
        marketRegistry.goLive(marketId, SCHEME_LIVE, liveId);
        assertEq(uint8(_stream(marketId).status), uint8(MarketRegistry.StreamStatus.Live));

        vm.prank(creator);
        marketRegistry.setEnded(marketId, SCHEME_LIVE, vodId);
        assertEq(_stream(marketId).endedAt, uint64(t0));

        vm.warp(t0 + 12 hours);
        vm.prank(creator);
        marketRegistry.setEnded(marketId, MarketRegistry.StorageScheme.Arweave, vodReviseId);
        assertEq(_stream(marketId).endedAt, uint64(t0));
        assertEq(uint8(_stream(marketId).scheme), uint8(MarketRegistry.StorageScheme.Arweave));
        assertEq(_stream(marketId).id, vodReviseId);

        vm.warp(t0 + 1 days + 1 hours);
        assertTrue(marketRegistry.isLocked(marketId));

        vm.prank(creator);
        vm.expectRevert("MarketRegistry: stream locked");
        marketRegistry.setEnded(marketId, MarketRegistry.StorageScheme.Ipfs, "late-vod-id");
    }
}
