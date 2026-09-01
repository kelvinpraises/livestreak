// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {Streams, StreamReceiver, StreamsHistory} from "./Streams.sol";
import {Managed} from "./Managed.sol";
import {IERC20, SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";

using SafeERC20 for IERC20;

/// @notice DripsStreaming — cycle-based streaming mined from Drips.
///
/// Drips is the quarry: this contract keeps the audited `Streams` cycle math verbatim and the
/// driver/custody plumbing, but drops the entire Splits fan-out subsystem (weighted multi-receiver
/// distribution), `give`, privacy and yield. The end goal is narrow — stream funds in over time and
/// let a single receiver collect once — so received cycles bank straight into a per-account
/// `collectable` ledger instead of the `splittable -> split -> collectable` two-step.
///
/// Capabilities: fund/reduce a stream (`setStreams`), settle finished cycles (`receiveStreams`),
/// force-settle the in-progress cycle from one sender (`squeezeStreams`), and collect once (`collect`).
contract DripsStreaming is Managed, Streams {
    uint256 public constant MAX_STREAMS_RECEIVERS = _MAX_STREAMS_RECEIVERS;
    uint8 public constant AMT_PER_SEC_EXTRA_DECIMALS = _AMT_PER_SEC_EXTRA_DECIMALS;
    uint160 public constant AMT_PER_SEC_MULTIPLIER = _AMT_PER_SEC_MULTIPLIER;
    uint128 public constant MAX_TOTAL_BALANCE = _MAX_STREAMS_BALANCE;
    uint8 public constant DRIVER_ID_OFFSET = 224;

    uint32 public immutable CYCLE_SECS;
    uint160 public immutable MIN_AMT_PER_SEC;
    bytes32 private immutable _DRIPS_STORAGE_SLOT = _erc1967Slot("eip1967.drips.storage");

    event DriverRegistered(uint32 indexed driverId, address indexed driverAddr);
    event DriverAddressUpdated(uint32 indexed driverId, address indexed oldDriverAddr, address indexed newDriverAddr);
    event Withdrawn(IERC20 indexed erc20, address indexed receiver, uint256 amt);
    event Collected(uint256 indexed accountId, IERC20 indexed erc20, uint128 amt);

    struct DripsStorage {
        uint32 nextDriverId;
        mapping(uint32 driverId => address) driverAddresses;
        mapping(IERC20 erc20 => Balance) balances;
        /// @notice Funds received by an account, ready to be collected once.
        mapping(uint256 accountId => mapping(IERC20 erc20 => uint128)) collectableAmts;
    }

    struct Balance {
        uint128 streams;
        uint128 collectable;
    }

    constructor(uint32 cycleSecs_) Streams(cycleSecs_, _erc1967Slot("eip1967.streams.storage")) {
        CYCLE_SECS = Streams._CYCLE_SECS;
        MIN_AMT_PER_SEC = Streams._MIN_AMT_PER_SEC;
    }

    modifier onlyDriver(uint256 accountId) {
        _onlyDriver(accountId);
        _;
    }

    function _onlyDriver(uint256 accountId) internal view {
        // upper 32 bits of accountId are driver ID
        // forge-lint: disable-next-line(unsafe-typecast)
        uint32 driverId = uint32(accountId >> DRIVER_ID_OFFSET);
        _assertCallerIsDriver(driverId);
    }

    function _assertCallerIsDriver(uint32 driverId) internal view {
        require(driverAddress(driverId) == msg.sender, "Callable only by the driver");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                        DRIVER MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    function registerDriver(address driverAddr) public whenNotPaused returns (uint32 driverId) {
        require(driverAddr != address(0), "Driver registered for 0 address");
        DripsStorage storage dripsStorage = _dripsStorage();
        driverId = dripsStorage.nextDriverId++;
        dripsStorage.driverAddresses[driverId] = driverAddr;
        emit DriverRegistered(driverId, driverAddr);
    }

    function driverAddress(uint32 driverId) public view returns (address driverAddr) {
        return _dripsStorage().driverAddresses[driverId];
    }

    function updateDriverAddress(uint32 driverId, address newDriverAddr) public whenNotPaused {
        _assertCallerIsDriver(driverId);
        _dripsStorage().driverAddresses[driverId] = newDriverAddr;
        emit DriverAddressUpdated(driverId, msg.sender, newDriverAddr);
    }

    function nextDriverId() public view returns (uint32 driverId) {
        return _dripsStorage().nextDriverId;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                        BALANCE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    function balances(IERC20 erc20) public view returns (uint128 streamsBalance, uint128 collectableBalance) {
        Balance storage balance = _dripsStorage().balances[erc20];
        return (balance.streams, balance.collectable);
    }

    function withdraw(IERC20 erc20, address receiver, uint256 amt) public {
        (uint128 streamsBalance, uint128 collectableBalance) = balances(erc20);
        uint256 withdrawable = erc20.balanceOf(address(this)) - streamsBalance - collectableBalance;
        require(amt <= withdrawable, "Withdrawal amount too high");
        emit Withdrawn(erc20, receiver, amt);
        erc20.safeTransfer(receiver, amt);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                        STREAMS
    // ═══════════════════════════════════════════════════════════════════════════

    function setStreams(
        uint256 accountId,
        IERC20 erc20,
        StreamReceiver[] memory currReceivers,
        int128 balanceDelta,
        StreamReceiver[] memory newReceivers,
        uint32 maxEndHint1,
        uint32 maxEndHint2
    ) public whenNotPaused onlyDriver(accountId) returns (int128 realBalanceDelta) {
        if (balanceDelta > 0) {
            // balanceDelta > 0 check ensures safe cast
            // forge-lint: disable-next-line(unsafe-typecast)
            uint128 amt = uint128(balanceDelta);
            _verifyBalanceIncrease(erc20, amt);
            _dripsStorage().balances[erc20].streams += amt;
        }
        realBalanceDelta =
            Streams._setStreams(accountId, erc20, currReceivers, balanceDelta, newReceivers, maxEndHint1, maxEndHint2);
        if (realBalanceDelta < 0) {
            // realBalanceDelta < 0 ensures negation fits in uint128
            // forge-lint: disable-next-line(unsafe-typecast)
            _dripsStorage().balances[erc20].streams -= uint128(-realBalanceDelta);
        }
    }

    function streamsState(uint256 accountId, IERC20 erc20)
        public
        view
        returns (bytes32 streamsHash, bytes32 streamsHistoryHash, uint32 updateTime, uint128 balance, uint32 maxEnd)
    {
        return Streams._streamsState(accountId, erc20);
    }

    /// @notice Settle finished cycles for the account, banking them into its collectable balance.
    function receiveStreams(uint256 accountId, IERC20 erc20, uint32 maxCycles)
        public
        whenNotPaused
        returns (uint128 receivedAmt)
    {
        receivedAmt = Streams._receiveStreams(accountId, erc20, maxCycles);
        if (receivedAmt != 0) {
            _bankReceived(accountId, erc20, receivedAmt);
        }
    }

    function receivableStreamsCycles(uint256 accountId, IERC20 erc20) public view returns (uint32 cycles) {
        return Streams._receivableStreamsCycles(accountId, erc20);
    }

    /// @notice Force-settle the in-progress cycle from a single sender (no need to wait for cycle end).
    /// This is the "force remove from cycle" capability: the receiver pulls already-streamed funds
    /// out of the current, not-yet-finished cycle.
    function squeezeStreams(
        uint256 accountId,
        IERC20 erc20,
        uint256 senderId,
        bytes32 historyHash,
        StreamsHistory[] memory streamsHistory
    ) public whenNotPaused returns (uint128 amt) {
        amt = Streams._squeezeStreams(accountId, erc20, senderId, historyHash, streamsHistory);
        if (amt != 0) {
            _bankReceived(accountId, erc20, amt);
        }
    }

    function squeezeStreamsResult(
        uint256 accountId,
        IERC20 erc20,
        uint256 senderId,
        bytes32 historyHash,
        StreamsHistory[] memory streamsHistory
    ) public view returns (uint128 amt) {
        (amt,,,,) = Streams._squeezeStreamsResult(accountId, erc20, senderId, historyHash, streamsHistory);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                        COLLECT
    // ═══════════════════════════════════════════════════════════════════════════

    function collectable(uint256 accountId, IERC20 erc20) public view returns (uint128 amt) {
        return _dripsStorage().collectableAmts[accountId][erc20];
    }

    /// @notice Collect all funds received by the account. Single-balance, collect-once.
    /// Collected funds become withdrawable; the driver calls `withdraw` to transfer them out.
    function collect(uint256 accountId, IERC20 erc20) public whenNotPaused onlyDriver(accountId) returns (uint128 amt) {
        DripsStorage storage dripsStorage = _dripsStorage();
        amt = dripsStorage.collectableAmts[accountId][erc20];
        if (amt != 0) {
            dripsStorage.collectableAmts[accountId][erc20] = 0;
            dripsStorage.balances[erc20].collectable -= amt;
        }
        emit Collected(accountId, erc20, amt);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                        INTERNAL
    // ═══════════════════════════════════════════════════════════════════════════

    function _bankReceived(uint256 accountId, IERC20 erc20, uint128 amt) internal {
        DripsStorage storage dripsStorage = _dripsStorage();
        dripsStorage.balances[erc20].streams -= amt;
        dripsStorage.balances[erc20].collectable += amt;
        dripsStorage.collectableAmts[accountId][erc20] += amt;
    }

    function _verifyBalanceIncrease(IERC20 erc20, uint128 amt) internal view {
        Balance storage balance = _dripsStorage().balances[erc20];
        uint256 newTotalBalance = uint256(balance.streams) + balance.collectable + amt;
        require(newTotalBalance <= MAX_TOTAL_BALANCE, "Total balance too high");
        require(newTotalBalance <= erc20.balanceOf(address(this)), "Token balance too low");
    }

    function _dripsStorage() internal view returns (DripsStorage storage storageRef) {
        bytes32 slot = _DRIPS_STORAGE_SLOT;
        assembly {
            storageRef.slot := slot
        }
    }
}
