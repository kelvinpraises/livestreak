// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {IDrips} from "../IDrips.sol";
import {StreamReceiver} from "../Streams.sol";
import {IERC20, SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC2771Context} from "openzeppelin-contracts/metatx/ERC2771Context.sol";

/// @notice Shared scaffolding for vault-aware funding drivers (ERC-2771 + Drips token plumbing).
/// Account resolution and auth stay in concrete drivers.
abstract contract SharedDriverUtils is ERC2771Context {
    IDrips public immutable DRIPS;
    IERC20 public immutable USDC;
    uint160 internal immutable AMT_MUL;

    constructor(IDrips drips_, address forwarder, IERC20 usdc_) ERC2771Context(forwarder) {
        DRIPS = drips_;
        USDC = usdc_;
        AMT_MUL = drips_.AMT_PER_SEC_MULTIPLIER();
    }

    function _drips() internal view virtual returns (IDrips) {
        return DRIPS;
    }

    function _callerAccountId() internal view virtual returns (uint256);

    function _collectAndTransfer(uint256 accountId, IERC20 erc20, address transferTo) internal returns (uint128 amt) {
        amt = _drips().collect(accountId, erc20);
        if (amt > 0) _drips().withdraw(erc20, transferTo, amt);
    }

    function _setStreamsAndTransfer(
        uint256 accountId,
        IERC20 erc20,
        StreamReceiver[] calldata currReceivers,
        int128 balanceDelta,
        StreamReceiver[] calldata newReceivers,
        uint32 maxEndHint1,
        uint32 maxEndHint2,
        address transferTo
    ) internal returns (int128 realBalanceDelta) {
        // balanceDelta > 0 ensures cast is safe
        // forge-lint: disable-next-line(unsafe-typecast)
        if (balanceDelta > 0) _transferFromCaller(erc20, uint128(balanceDelta));
        realBalanceDelta =
            _drips().setStreams(accountId, erc20, currReceivers, balanceDelta, newReceivers, maxEndHint1, maxEndHint2);
        // realBalanceDelta < 0 ensures negation fits in uint128
        // forge-lint: disable-next-line(unsafe-typecast)
        if (realBalanceDelta < 0) _drips().withdraw(erc20, transferTo, uint128(-realBalanceDelta));
    }

    function _transferFromCaller(IERC20 erc20, uint128 amt) internal {
        SafeERC20.safeTransferFrom(erc20, _msgSender(), address(_drips()), amt);
    }
}
