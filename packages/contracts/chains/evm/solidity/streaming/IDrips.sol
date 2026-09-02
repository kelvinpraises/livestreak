// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {StreamReceiver, StreamsHistory} from "./Streams.sol";

/// @notice Interface drivers use to talk to `DripsStreaming`.
/// Trimmed to the mined streaming surface: no splits, give, yield or metadata.
interface IDrips {
    function registerDriver(address driverAddr) external returns (uint32 driverId);
    function driverAddress(uint32 driverId) external view returns (address driverAddr);
    function updateDriverAddress(uint32 driverId, address newDriverAddr) external;
    function nextDriverId() external view returns (uint32 driverId);

    function balances(IERC20 erc20) external view returns (uint128 streamsBalance, uint128 collectableBalance);
    function withdraw(IERC20 erc20, address receiver, uint256 amt) external;

    function setStreams(
        uint256 accountId,
        IERC20 erc20,
        StreamReceiver[] memory currReceivers,
        int128 balanceDelta,
        StreamReceiver[] memory newReceivers,
        uint32 maxEndHint1,
        uint32 maxEndHint2
    ) external returns (int128 realBalanceDelta);
    function streamsState(uint256 accountId, IERC20 erc20)
        external
        view
        returns (bytes32, bytes32, uint32, uint128, uint32);

    function receiveStreams(uint256 accountId, IERC20 erc20, uint32 maxCycles) external returns (uint128 receivedAmt);
    function receivableStreamsCycles(uint256 accountId, IERC20 erc20) external view returns (uint32 cycles);

    function squeezeStreams(
        uint256 accountId,
        IERC20 erc20,
        uint256 senderId,
        bytes32 historyHash,
        StreamsHistory[] memory streamsHistory
    ) external returns (uint128 amt);
    function squeezeStreamsResult(
        uint256 accountId,
        IERC20 erc20,
        uint256 senderId,
        bytes32 historyHash,
        StreamsHistory[] memory streamsHistory
    ) external view returns (uint128 amt);

    function collectable(uint256 accountId, IERC20 erc20) external view returns (uint128 amt);
    function collect(uint256 accountId, IERC20 erc20) external returns (uint128 amt);

    function CYCLE_SECS() external view returns (uint32);
    function MIN_AMT_PER_SEC() external view returns (uint160);
    function AMT_PER_SEC_MULTIPLIER() external view returns (uint160);
}
