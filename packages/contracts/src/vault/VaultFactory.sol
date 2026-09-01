// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BookmakerRegistry} from "../bookmaker/BookmakerRegistry.sol";
import {MarketRegistry} from "../market/MarketRegistry.sol";
import {Vault} from "./Vault.sol";

/// @title VaultFactory — bookmaker-gated vault creation under an existing market
contract VaultFactory {
    BookmakerRegistry public immutable bookmakerRegistry;
    MarketRegistry public immutable marketRegistry;
    Vault public immutable vault;

    event VaultCreated(bytes32 indexed marketId, bytes32 indexed vaultId, address indexed creator, string question);

    constructor(BookmakerRegistry bookmakerRegistry_, MarketRegistry marketRegistry_, Vault vault_) {
        require(
            address(bookmakerRegistry_) != address(0) && address(marketRegistry_) != address(0)
                && address(vault_) != address(0),
            "VaultFactory: zero address"
        );
        bookmakerRegistry = bookmakerRegistry_;
        marketRegistry = marketRegistry_;
        vault = vault_;
    }

    function createVault(bytes32 marketId, string calldata question) external returns (bytes32 vaultId) {
        require(bookmakerRegistry.isAuthorized(msg.sender), "VaultFactory: not bookmaker");
        require(marketRegistry.marketExists(marketId), "VaultFactory: unknown market");

        vaultId = vault.createVault(marketId, question, msg.sender);
        marketRegistry.addVault(marketId, vaultId);

        emit VaultCreated(marketId, vaultId, msg.sender, question);
    }
}
