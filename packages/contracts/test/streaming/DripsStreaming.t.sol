// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DripsStreaming} from "../../src/streaming/DripsStreaming.sol";
import {ManagedProxy} from "../../src/streaming/Managed.sol";
import {StreamReceiver, StreamConfigImpl, StreamsHistory} from "../../src/streaming/Streams.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @notice Proves the mined Drips streaming primitive: cycle accrual, force-settle (squeeze),
/// halting, independent accounts, real USDC custody, and the balance-bound revert paths.
///
/// This test IS the driver: it registers `address(this)` as a Drips driver and drives streams
/// directly (the product's only driver, the vault-aware AddressDriver, streams to vaults, so it
/// can't be used as a generic rail harness). Account ids are `(driverId << 224) | addr`.
///
/// Timing is cycle-aligned (`CYCLE = 10`, `START = 100`, warps to multiples of 10) so a stream of
/// `rate` over `N` finished cycles accrues exactly `N * CYCLE * rate`. `receiveStreams` banks only
/// finished cycles; the in-progress cycle needs `squeezeStreams`.
contract DripsStreamingTest is Test {
    uint32 internal constant CYCLE = 10;
    uint256 internal constant START = 100;
    uint160 internal constant MULT = 1_000_000_000;
    uint256 internal constant RATE = 1_000_000; // 1 USDC/sec (6 decimals)
    uint160 internal constant MIN_RAW = 100_000_000; // _MIN_AMT_PER_SEC for cycleSecs 10

    DripsStreaming internal drips;
    MockUSDC internal usdc;
    uint32 internal driverId;

    address internal sender = makeAddr("sender");
    address internal receiver = makeAddr("receiver");
    address internal senderB = makeAddr("senderB");
    address internal receiverB = makeAddr("receiverB");
    address internal senderMax = makeAddr("senderMax");

    function setUp() public {
        vm.warp(START);

        DripsStreaming logic = new DripsStreaming(CYCLE);
        drips = DripsStreaming(address(new ManagedProxy(logic, address(this), "")));
        // This test contract is the driver.
        driverId = drips.registerDriver(address(this));
        usdc = new MockUSDC();

        assertEq(drips.CYCLE_SECS(), CYCLE);
        assertEq(uint256(drips.AMT_PER_SEC_MULTIPLIER()), uint256(MULT));
        assertEq(uint256(drips.MIN_AMT_PER_SEC()), uint256(MIN_RAW));
        assertEq(drips.driverAddress(driverId), address(this));
    }

    // ── helpers ────────────────────────────────────────────────────────────────

    function _acct(address addr) internal view returns (uint256) {
        return (uint256(driverId) << 224) | uint160(addr);
    }

    function _empty() internal pure returns (StreamReceiver[] memory r) {
        r = new StreamReceiver[](0);
    }

    function _receivers(uint256 accountId, uint256 rate) internal pure returns (StreamReceiver[] memory r) {
        r = new StreamReceiver[](1);
        r[0] = StreamReceiver({accountId: accountId, config: StreamConfigImpl.create(0, uint160(rate * MULT), 0, 0)});
    }

    function _rawReceivers(uint256 accountId, uint160 raw) internal pure returns (StreamReceiver[] memory r) {
        r = new StreamReceiver[](1);
        r[0] = StreamReceiver({accountId: accountId, config: StreamConfigImpl.create(0, raw, 0, 0)});
    }

    /// @notice Open a stream `from -> recvId` at `rate` depositing `deposit`. Tokens are minted
    /// straight into the streaming contract (real custody) before the driver opens the stream.
    function _stream(address from, uint256 recvId, uint256 rate, uint256 deposit) internal {
        usdc.mint(address(drips), deposit);
        drips.setStreams(_acct(from), usdc, _empty(), int128(uint128(deposit)), _receivers(recvId, rate), 0, 0);
    }

    // ── tests ──────────────────────────────────────────────────────────────────

    /// (a) Streams accrue over full finished cycles.
    function test_streamAccruesOverFullCycles() public {
        uint256 recvId = _acct(receiver);
        _stream(sender, recvId, RATE, 100 * RATE);

        vm.warp(START + 30); // 3 finished cycles; the 4th is in-progress

        uint128 received = drips.receiveStreams(recvId, usdc, type(uint32).max);
        assertEq(uint256(received), 30 * RATE);
        assertEq(uint256(drips.collectable(recvId, usdc)), 30 * RATE);
    }

    /// (b) Real custody: DripsStreaming holds funded USDC, and collect + withdraw transfers it OUT.
    function test_custodyHeldThenTransferredOnCollect() public {
        uint256 recvId = _acct(receiver);
        _stream(sender, recvId, RATE, 100 * RATE);

        uint256 dripsHeld = usdc.balanceOf(address(drips));
        assertEq(dripsHeld, 100 * RATE);
        uint256 recvBefore = usdc.balanceOf(receiver);

        vm.warp(START + 30);
        drips.receiveStreams(recvId, usdc, type(uint32).max); // banks 30 USDC, moves no tokens

        uint128 collected = drips.collect(recvId, usdc); // driver collects (zeroes the ledger)
        assertEq(uint256(collected), 30 * RATE);
        drips.withdraw(usdc, receiver, collected); // then transfers out

        assertEq(usdc.balanceOf(address(drips)), dripsHeld - 30 * RATE, "custody out");
        assertEq(usdc.balanceOf(receiver), recvBefore + 30 * RATE, "receiver in");
    }

    /// (c) Squeeze force-settles the in-progress cycle without waiting for it to finish.
    function test_squeezeForceSettlesCurrentCycle() public {
        uint256 recvId = _acct(receiver);
        uint256 senderId = _acct(sender);
        _stream(sender, recvId, RATE, 100 * RATE);

        vm.warp(START + 5); // mid first cycle: nothing receivable yet
        assertEq(drips.receivableStreamsCycles(recvId, usdc), 0);

        (,, uint32 updateTime,, uint32 maxEnd) = drips.streamsState(senderId, usdc);
        StreamsHistory[] memory history = new StreamsHistory[](1);
        history[0] = StreamsHistory({
            streamsHash: bytes32(0), receivers: _receivers(recvId, RATE), updateTime: updateTime, maxEnd: maxEnd
        });

        uint128 squeezed = drips.squeezeStreams(recvId, usdc, senderId, bytes32(0), history);
        assertEq(uint256(squeezed), 5 * RATE);
        assertEq(uint256(drips.collectable(recvId, usdc)), 5 * RATE);
    }

    /// (d) Stopping a stream halts further accrual; already-finished cycles stay receivable.
    function test_stopHaltsFurtherAccrual() public {
        uint256 recvId = _acct(receiver);
        _stream(sender, recvId, RATE, 100 * RATE);

        vm.warp(START + 20); // 2 finished cycles, then stop
        drips.setStreams(_acct(sender), usdc, _receivers(recvId, RATE), 0, _empty(), 0, 0);

        vm.warp(200);
        uint128 first = drips.receiveStreams(recvId, usdc, type(uint32).max);
        assertEq(uint256(first), 20 * RATE);
        uint128 second = drips.receiveStreams(recvId, usdc, type(uint32).max);
        assertEq(uint256(second), 0);
    }

    /// (e) Two senders / two receivers accrue independently and do not interfere.
    function test_independentAccrualTwoSendersTwoReceivers() public {
        uint256 recvIdA = _acct(receiver);
        uint256 recvIdB = _acct(receiverB);
        _stream(sender, recvIdA, RATE, 100 * RATE);
        _stream(senderB, recvIdB, 2 * RATE, 200 * RATE);

        vm.warp(START + 30);

        uint128 receivedA = drips.receiveStreams(recvIdA, usdc, type(uint32).max);
        uint128 receivedB = drips.receiveStreams(recvIdB, usdc, type(uint32).max);
        assertEq(uint256(receivedA), 30 * RATE);
        assertEq(uint256(receivedB), 60 * RATE);
    }

    /// (f) amtPerSec below the per-cycle minimum reverts (validated before any balance check).
    function test_revert_setStreamsBelowMinAmtPerSec() public {
        uint256 recvId = _acct(receiver);
        vm.expectRevert(bytes("Stream receiver amtPerSec too low"));
        drips.setStreams(_acct(sender), usdc, _empty(), 0, _rawReceivers(recvId, MIN_RAW - 1), 0, 0);
    }

    /// (f) A balance increase past MAX_TOTAL_BALANCE reverts.
    function test_revert_setStreamsAboveMaxTotalBalance() public {
        uint256 maxBal = uint256(uint128(type(int128).max));

        usdc.mint(address(drips), maxBal);
        drips.setStreams(_acct(senderMax), usdc, _empty(), type(int128).max, _empty(), 0, 0);

        usdc.mint(address(drips), 1);
        vm.expectRevert(bytes("Total balance too high"));
        drips.setStreams(_acct(senderMax), usdc, _empty(), 1, _empty(), 0, 0);
    }
}
