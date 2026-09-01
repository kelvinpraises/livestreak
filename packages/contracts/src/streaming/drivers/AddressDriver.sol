// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {IDrips} from "../IDrips.sol";
import {StreamReceiver, StreamConfigImpl, StreamsHistory} from "../Streams.sol";
import {Managed} from "../Managed.sol";
import {DriverTransferUtils} from "./DriverTransferUtils.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {Vault} from "../../vault/Vault.sol";
import {Side} from "../../vault/Side.sol";

/// @notice Vault-aware Drips driver. Each address controls the account `(DRIVER_ID << 224) | addr`
/// and streams USDC **only** into vault-sides — never to an arbitrary receiver. `fund`/`stop` set the
/// real Drips stream and update the Vault's Board in the same call, so the Board can never desync.
///
/// @dev One active position per account; spin up another AA account for an independent position.
/// `settle` squeezes the in-flight cycle into the vault-side at resolution; `claim` withdraws a
/// winner's payout. Multi-vault-per-account (one config, many receivers — proven safe in Streams.sol)
/// is the remaining refinement.
contract AddressDriver is DriverTransferUtils, Managed {
    IDrips public immutable DRIPS;
    uint32 public immutable DRIVER_ID;
    Vault public immutable VAULT;
    IERC20 public immutable USDC;
    uint160 internal immutable AMT_MUL;

    struct ActiveStream {
        bytes32 vaultId;
        Side side;
        uint256 rate;
        bool active;
        bytes32 histBefore; // streams-history hash just before this position opened (squeeze prefix)
    }

    mapping(uint256 account => ActiveStream) public activeStream;

    event PositionFunded(
        address indexed funder, bytes32 indexed vaultId, Side side, uint256 rate, uint256 deposit, uint32 maxEnd
    );
    event PositionStopped(address indexed funder, bytes32 indexed vaultId, Side side, uint256 refunded);
    event PositionSettled(address indexed funder, bytes32 indexed vaultId, Side side, uint128 squeezed);

    constructor(IDrips drips_, address forwarder, uint32 driverId_, Vault vault_, IERC20 usdc_)
        DriverTransferUtils(forwarder)
    {
        DRIPS = drips_;
        DRIVER_ID = driverId_;
        VAULT = vault_;
        USDC = usdc_;
        AMT_MUL = drips_.AMT_PER_SEC_MULTIPLIER();
    }

    function _drips() internal view override returns (IDrips) {
        return DRIPS;
    }

    /// @notice The account controlled by `addr`.
    function calcAccountId(address addr) public view returns (uint256 accountId) {
        accountId = DRIVER_ID;
        accountId = (accountId << 224) | uint160(addr);
    }

    function _callerAccountId() internal view returns (uint256) {
        return calcAccountId(_msgSender());
    }

    /// @notice Open a USDC stream from the caller into `(vaultId, side)` at `rate`, funded by `deposit`.
    function fund(bytes32 vaultId, Side side, uint256 rate, uint256 deposit) external whenNotPaused {
        require(rate > 0, "AddressDriver: zero rate");
        require(deposit > 0 && deposit <= uint256(uint128(type(int128).max)), "AddressDriver: bad deposit");
        uint256 account = _callerAccountId();
        require(!activeStream[account].active, "AddressDriver: account already funding");

        uint256 receiver = VAULT.receiverAccount(vaultId, side);
        StreamReceiver[] memory newReceivers = new StreamReceiver[](1);
        newReceivers[0] =
            StreamReceiver({accountId: receiver, config: StreamConfigImpl.create(0, uint160(rate * AMT_MUL), 0, 0)});

        // tokens into Drips first (setStreams verifies the increase), then open the stream
        _transferFromCaller(USDC, uint128(deposit));
        (, bytes32 histBefore,,,) = DRIPS.streamsState(account, USDC); // history before this stream → squeeze prefix
        DRIPS.setStreams(account, USDC, new StreamReceiver[](0), int128(uint128(deposit)), newReceivers, 0, 0);
        (,,,, uint32 maxEnd) = DRIPS.streamsState(account, USDC);

        activeStream[account] =
            ActiveStream({vaultId: vaultId, side: side, rate: rate, active: true, histBefore: histBefore});
        VAULT.onFund(_msgSender(), vaultId, side, rate, maxEnd);
        emit PositionFunded(_msgSender(), vaultId, side, rate, deposit, maxEnd);
    }

    /// @notice Stop the caller's position; refunds unspent USDC and closes the Board entry.
    function stop() external whenNotPaused {
        uint256 account = _callerAccountId();
        ActiveStream memory a = activeStream[account];
        require(a.active, "AddressDriver: no active position");

        // Bank the in-flight cycle to the vault-side first, so everything streamed up to now (including
        // any post-resolution overage) is collectable; then close the stream and refund the unspent.
        _squeezeInflight(account, a);

        uint256 receiver = VAULT.receiverAccountView(a.vaultId, a.side);
        StreamReceiver[] memory currReceivers = new StreamReceiver[](1);
        currReceivers[0] =
            StreamReceiver({accountId: receiver, config: StreamConfigImpl.create(0, uint160(a.rate * AMT_MUL), 0, 0)});

        // empty new receivers + min delta = withdraw all unspent (Drips caps the delta at the balance)
        int128 realDelta =
            DRIPS.setStreams(account, USDC, currReceivers, type(int128).min, new StreamReceiver[](0), 0, 0);
        uint256 refunded;
        if (realDelta < 0) {
            refunded = uint256(uint128(-realDelta));
            DRIPS.withdraw(USDC, _msgSender(), refunded);
        }

        activeStream[account].active = false;
        VAULT.onStop(_msgSender(), a.vaultId, a.side);
        emit PositionStopped(_msgSender(), a.vaultId, a.side, refunded);
    }

    /// @dev Squeeze `account`'s in-flight Drips cycle into its vault-side receiver, banking USDC
    /// streamed so far in the current (unfinished) cycle. Shared by `settle` (resolution) and `stop`.
    /// A squeeze only moves funds from in-flight to the receiver's collectable balance — never out (only
    /// the Vault, as the receiver's driver, withdraws) — so this is safe to do permissionlessly. The
    /// driver holds the sender's stream history, which is what a squeeze needs.
    function _squeezeInflight(uint256 account, ActiveStream memory a) internal returns (uint128 squeezed) {
        uint256 receiver = VAULT.receiverAccountView(a.vaultId, a.side);
        StreamReceiver[] memory recv = new StreamReceiver[](1);
        recv[0] =
            StreamReceiver({accountId: receiver, config: StreamConfigImpl.create(0, uint160(a.rate * AMT_MUL), 0, 0)});

        (,, uint32 updateTime,, uint32 maxEnd) = DRIPS.streamsState(account, USDC);
        StreamsHistory[] memory hist = new StreamsHistory[](1);
        hist[0] = StreamsHistory({streamsHash: bytes32(0), receivers: recv, updateTime: updateTime, maxEnd: maxEnd});

        squeezed = DRIPS.squeezeStreams(receiver, USDC, account, a.histBefore, hist);
    }

    /// @notice Force-settle `funder`'s in-flight Drips cycle into the vault-side receiver right now, so
    /// resolution `collect` captures it instead of stranding it until the cycle finishes. A live market
    /// resolves mid-cycle, so without this the pot's cash would be short by every active funder's cycle.
    function settle(address funder) external whenNotPaused returns (uint128 squeezed) {
        uint256 account = calcAccountId(funder);
        ActiveStream memory a = activeStream[account];
        require(a.active, "AddressDriver: no active position");
        squeezed = _squeezeInflight(account, a);
        emit PositionSettled(funder, a.vaultId, a.side, squeezed);
    }

    /// @notice Claim the caller's winnings from a resolved vault (forwards to the Vault payout).
    function claim(bytes32 vaultId, Side side) external whenNotPaused returns (uint256 payout) {
        return VAULT.claimFor(_msgSender(), vaultId, side);
    }

    /// @notice Reclaim the caller's USDC streamed after the vault resolved (the over-stream refund).
    function reclaim(bytes32 vaultId, Side side) external whenNotPaused returns (uint256) {
        return VAULT.reclaimOverage(_msgSender(), vaultId, side);
    }
}
