// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Protocol} from "../Protocol.sol";

/// @title MarketRegistry — observer-created market index and vault catalog
/// @notice Owns market registration and market -> vault id index. Vault creation is VaultDriver-gated.
/// @dev marketId = keccak256(abi.encode(observer, streamId)). registerMarket is state writes + emit only (no external calls).
contract MarketRegistry is Ownable {
    Protocol public immutable protocol;

    struct MarketData {
        bytes32 id;
        string title;
        bytes32 streamId;
        address creator;
        uint256 createdAt;
        bool exists;
    }

    uint256 public marketCount;
    bytes32[] private _marketIds;
    mapping(bytes32 => MarketData) public markets;
    mapping(bytes32 => bytes32[]) private _vaultIdsByMarket;

    event MarketRegistered(bytes32 indexed marketId, address indexed creator, bytes32 indexed streamId, string title);
    event VaultIndexed(bytes32 indexed marketId, bytes32 indexed vaultId);

    constructor(address initialOwner, Protocol protocol_) Ownable(initialOwner) {
        require(address(protocol_) != address(0), "MarketRegistry: zero protocol");
        protocol = protocol_;
    }

    function computeMarketId(address observer, bytes32 streamId) public pure returns (bytes32) {
        return keccak256(abi.encode(observer, streamId));
    }

    function vaultDriver() public view returns (address) {
        return protocol.vaultDriver();
    }

    function registerMarket(string calldata title, bytes32 streamId) external returns (bytes32 marketId) {
        require(bytes(title).length > 0, "MarketRegistry: empty title");
        require(streamId != bytes32(0), "MarketRegistry: zero streamId");

        marketId = computeMarketId(msg.sender, streamId);
        require(!markets[marketId].exists, "MarketRegistry: market exists");

        markets[marketId] = MarketData({
            id: marketId,
            title: title,
            streamId: streamId,
            creator: msg.sender,
            createdAt: block.timestamp,
            exists: true
        });

        marketCount++;
        _marketIds.push(marketId);

        emit MarketRegistered(marketId, msg.sender, streamId, title);
    }

    function addVault(bytes32 marketId, bytes32 vaultId) external {
        require(msg.sender == vaultDriver(), "MarketRegistry: not vault driver");
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
