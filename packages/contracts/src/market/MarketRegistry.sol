// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MarketRegistry — observer-created market index and vault catalog
/// @notice Owns market registration and market -> vault id index. Vault creation is factory-gated.
/// @dev v0 market ids are sequential: `bytes32(uint256(n))` for n = 1, 2, 3, ...
contract MarketRegistry is Ownable {
    struct MarketData {
        bytes32 id;
        string title;
        bytes32 streamId;
        uint256 createdAt;
        bool exists;
    }

    address public vaultFactory;

    uint256 public marketCount;
    bytes32[] private _marketIds;
    mapping(bytes32 => MarketData) public markets;
    mapping(bytes32 => bytes32[]) private _vaultIdsByMarket;

    event MarketRegistered(bytes32 indexed marketId, string title, bytes32 indexed streamId);
    event VaultIndexed(bytes32 indexed marketId, bytes32 indexed vaultId);
    event VaultFactorySet(address indexed vaultFactory);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setVaultFactory(address factory) external onlyOwner {
        require(factory != address(0), "MarketRegistry: zero factory");
        vaultFactory = factory;
        emit VaultFactorySet(factory);
    }

    function registerMarket(string calldata title, bytes32 streamId) external returns (bytes32 marketId) {
        require(bytes(title).length > 0, "MarketRegistry: empty title");

        marketCount++;
        marketId = bytes32(marketCount);
        require(!markets[marketId].exists, "MarketRegistry: duplicate market");

        markets[marketId] =
            MarketData({id: marketId, title: title, streamId: streamId, createdAt: block.timestamp, exists: true});

        _marketIds.push(marketId);

        emit MarketRegistered(marketId, title, streamId);
    }

    function addVault(bytes32 marketId, bytes32 vaultId) external {
        require(msg.sender == vaultFactory, "MarketRegistry: not factory");
        require(markets[marketId].exists, "MarketRegistry: unknown market");

        _vaultIdsByMarket[marketId].push(vaultId);
        emit VaultIndexed(marketId, vaultId);
    }

    function marketExists(bytes32 marketId) external view returns (bool) {
        return markets[marketId].exists;
    }

    function getMarket(bytes32 marketId) external view returns (MarketData memory) {
        require(markets[marketId].exists, "MarketRegistry: unknown market");
        return markets[marketId];
    }

    function marketIdAt(uint256 index) external view returns (bytes32) {
        require(index < _marketIds.length, "MarketRegistry: index out of bounds");
        return _marketIds[index];
    }

    function getVaultIds(bytes32 marketId) external view returns (bytes32[] memory) {
        require(markets[marketId].exists, "MarketRegistry: unknown market");
        return _vaultIdsByMarket[marketId];
    }
}
