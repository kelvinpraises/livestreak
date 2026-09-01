// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title BookmakerRegistry — minimal authorization gate for vault creation
/// @notice Owner authorizes addresses that may call VaultFactory.createVault. No agent metadata in v0.
contract BookmakerRegistry is Ownable {
    mapping(address => bool) public authorizedBookmakers;

    event BookmakerAuthorizationSet(address indexed bookmaker, bool authorized);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setBookmaker(address bookmaker, bool authorized) external onlyOwner {
        require(bookmaker != address(0), "BookmakerRegistry: zero bookmaker");
        authorizedBookmakers[bookmaker] = authorized;
        emit BookmakerAuthorizationSet(bookmaker, authorized);
    }

    function isAuthorized(address bookmaker) external view returns (bool) {
        return authorizedBookmakers[bookmaker];
    }
}
