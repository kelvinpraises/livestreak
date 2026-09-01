// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Vault} from "../vault/Vault.sol";

/// @title StewardRegistry — steward registration, hot/dispute hooks, and the resolution authority.
/// @notice Steward package owns the decision workflow; the Vault holds visible state and the payout.
/// This registry is the Vault's `resolver`: a registered steward calls `resolveVault` to set the
/// outcome. v0 is single-steward authority — quorum, challenge windows, stake-weighting and slashing
/// are documented refinements (see docs/streamed-funding-explained.md and README.md).
contract StewardRegistry is Ownable {
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
    mapping(bytes32 => HotState) public vaultHotState;
    mapping(bytes32 => DisputeState) public disputeState;

    address public vault; // the Vault this registry resolves (set once)

    event StewardRegistered(address indexed steward);
    event VaultSet(address indexed vault);
    event VaultResolved(bytes32 indexed vaultId, Vault.Outcome outcome, address indexed steward);
    event HotTriggered(bytes32 indexed vaultId, Severity severity, uint256 until, bytes32 reasonHash);
    event HotEnded(bytes32 indexed vaultId);
    event DisputeOpened(bytes32 indexed vaultId, uint256 challengeUntil, bytes32 proofRef);
    event DisputeClosed(bytes32 indexed vaultId);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function registerSteward(address steward) external onlyOwner {
        require(steward != address(0), "StewardRegistry: zero steward");
        stewards[steward] = true;
        emit StewardRegistered(steward);
    }

    /// @notice Wire the Vault this registry resolves, once. The Vault must point its `resolver` here.
    function setVault(address vault_) external onlyOwner {
        require(vault == address(0), "StewardRegistry: vault already set");
        require(vault_ != address(0), "StewardRegistry: zero vault");
        vault = vault_;
        emit VaultSet(vault_);
    }

    /// @notice Resolve a vault's outcome. v0: any registered steward may call. The Vault enforces that
    /// only its `resolver` (this registry) can flip the outcome, so this is the sole resolution path.
    function resolveVault(bytes32 vaultId, Vault.Outcome outcome) external {
        require(stewards[msg.sender], "StewardRegistry: not steward");
        Vault(vault).resolve(vaultId, outcome);
        emit VaultResolved(vaultId, outcome, msg.sender);
    }

    function triggerHot(bytes32 vaultId, Severity severity, uint256 until, bytes32 reasonHash) external {
        require(stewards[msg.sender], "StewardRegistry: not steward");

        vaultHotState[vaultId] = HotState({active: true, until: until, severity: severity, reasonHash: reasonHash});
        emit HotTriggered(vaultId, severity, until, reasonHash);
    }

    function endHot(bytes32 vaultId) external {
        require(stewards[msg.sender], "StewardRegistry: not steward");

        delete vaultHotState[vaultId];
        emit HotEnded(vaultId);
    }

    function openDispute(bytes32 vaultId, uint256 challengeUntil, bytes32 proofRef) external {
        require(stewards[msg.sender], "StewardRegistry: not steward");

        disputeState[vaultId] = DisputeState({active: true, challengeUntil: challengeUntil, proofRef: proofRef});
        emit DisputeOpened(vaultId, challengeUntil, proofRef);
    }

    function closeDispute(bytes32 vaultId) external {
        require(stewards[msg.sender], "StewardRegistry: not steward");

        delete disputeState[vaultId];
        emit DisputeClosed(vaultId);
    }
}
