// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Protocol} from "../Protocol.sol";

/// @title LvstToken (LVST) — the LiveStreak ERC-20 unit.
/// @notice Mint authority is Treasury only; economic engine lives in `Treasury.sol`.
contract LvstToken is ERC20 {
    Protocol public immutable protocol;

    constructor(Protocol protocol_) ERC20("LiveStreak", "LVST") {
        require(address(protocol_) != address(0), "LvstToken: zero protocol");
        protocol = protocol_;
    }

    /// @dev D2 DECISION: LVST decimals are chain-LOCAL. EVM = 18 (ERC-20 norm), Sui = 9 (see
    ///      lvst.move). This is an intentional divergence — do NOT standardize. Stated explicitly
    ///      here (rather than relying on the ERC20 default) so no consumer has to guess the scale;
    ///      the mint RATE is identical across chains, only the base-unit scale differs.
    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == protocol.treasury(), "LvstToken: not treasury");
        _mint(to, amount);
    }

    /// @dev Treasury pulls LVST from `from` without ERC-20 allowance (same contract in v0).
    function pullFrom(address from, uint256 amount) external {
        require(msg.sender == protocol.treasury(), "LvstToken: not treasury");
        _transfer(from, msg.sender, amount);
    }
}
