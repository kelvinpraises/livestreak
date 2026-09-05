// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Protocol} from "../Protocol.sol";
import {Vault} from "../vault/Vault.sol";

/// @title StewardRegistry — steward registration, per-market assignment, hot/dispute hooks, and resolution.
/// @notice The Vault's `resolver`. v0 wires one steward as `defaultSteward`; markets may override via owner assignment.
contract StewardRegistry is Ownable {
    Protocol public immutable protocol;

    enum Severity {
        Warm,
        Hot,
        Critical
    }

    struct HotState {
        bool active;
        uint256 until;
        Severity severity;
        bytes32 reasonHash;
    }

    struct DisputeState {
        bool active;
        uint256 challengeUntil;
        bytes32 proofRef;
    }

    mapping(address => bool) public stewards;
    mapping(bytes32 => address) public marketSteward;
    mapping(bytes32 => HotState) public vaultHotState;
    mapping(bytes32 => DisputeState) public disputeState;

    address public defaultSteward;

    event StewardRegistered(address indexed steward);
    event DefaultStewardSet(address indexed steward);
    event MarketStewardSet(bytes32 indexed marketId, address indexed steward);
    event VaultResolved(bytes32 indexed vaultId, Vault.Outcome outcome, address indexed steward);
    event HotTriggered(bytes32 indexed vaultId, Severity severity, uint256 until, bytes32 reasonHash);
    event HotEnded(bytes32 indexed vaultId);
    event DisputeOpened(bytes32 indexed vaultId, uint256 challengeUntil, bytes32 proofRef);
    event DisputeClosed(bytes32 indexed vaultId);

    constructor(address initialOwner, Protocol protocol_) Ownable(initialOwner) {
        require(address(protocol_) != address(0), "StewardRegistry: zero protocol");
        protocol = protocol_;
    }

    function vault() public view returns (address) {
        return protocol.vault();
    }

    function registerSteward(address steward) external onlyOwner {
        require(steward != address(0), "StewardRegistry: zero steward");
        stewards[steward] = true;
        emit StewardRegistered(steward);
    }

    function setDefaultSteward(address steward) external onlyOwner {
        require(steward != address(0), "StewardRegistry: zero steward");
        require(stewards[steward], "StewardRegistry: unregistered steward");
        defaultSteward = steward;
        emit DefaultStewardSet(steward);
    }

    function setMarketSteward(bytes32 marketId, address steward) external onlyOwner {
        require(steward != address(0), "StewardRegistry: zero steward");
        require(stewards[steward], "StewardRegistry: unregistered steward");
        marketSteward[marketId] = steward;
        emit MarketStewardSet(marketId, steward);
    }

    function effectiveSteward(bytes32 marketId) public view returns (address) {
        address assigned = marketSteward[marketId];
        if (assigned != address(0)) return assigned;
        return defaultSteward;
    }

    function resolveVault(bytes32 vaultId, Vault.Outcome outcome) external {
        _requireMarketSteward(vaultId);
        Vault(protocol.vault()).resolve(vaultId, outcome);
        emit VaultResolved(vaultId, outcome, msg.sender);
    }

    function triggerHot(bytes32 vaultId, Severity severity, uint256 until, bytes32 reasonHash) external {
        _requireMarketSteward(vaultId);

        vaultHotState[vaultId] = HotState({active: true, until: until, severity: severity, reasonHash: reasonHash});
        emit HotTriggered(vaultId, severity, until, reasonHash);
    }

    function endHot(bytes32 vaultId) external {
        _requireMarketSteward(vaultId);

        delete vaultHotState[vaultId];
        emit HotEnded(vaultId);
    }

    function openDispute(bytes32 vaultId, uint256 challengeUntil, bytes32 proofRef) external {
        _requireMarketSteward(vaultId);

        disputeState[vaultId] = DisputeState({active: true, challengeUntil: challengeUntil, proofRef: proofRef});
        emit DisputeOpened(vaultId, challengeUntil, proofRef);
    }

    function closeDispute(bytes32 vaultId) external {
        _requireMarketSteward(vaultId);

        delete disputeState[vaultId];
        emit DisputeClosed(vaultId);
    }

    function _requireMarketSteward(bytes32 vaultId) internal view {
        bytes32 marketId = Vault(protocol.vault()).marketId(vaultId);
        address effective = effectiveSteward(marketId);
        // E1 TODO: if a `removeSteward` path is ever added, also re-assert `stewards[effective]`
        // here so a de-registered (but still assigned) steward cannot continue acting. No live risk
        // today — there is no removal path, so an assigned steward is always registered.
        require(effective != address(0), "StewardRegistry: no steward");
        require(msg.sender == effective, "StewardRegistry: not market steward");
    }
}
