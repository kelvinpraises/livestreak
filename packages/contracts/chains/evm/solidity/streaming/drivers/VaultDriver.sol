// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {StreamReceiver, StreamConfigImpl} from "../Streams.sol";
import {SharedDriverUtils} from "./SharedDriverUtils.sol";
import {IDrips} from "../IDrips.sol";
import {Protocol} from "../../Protocol.sol";
import {Vault} from "../../vault/Vault.sol";
import {Side} from "../../vault/Side.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";

interface IMarketRegistry {
    function marketExists(bytes32 marketId) external view returns (bool);
    function addVault(bytes32 marketId, bytes32 vaultId) external;
}

/// @notice Receiver-side Drips adapter + permissionless vault creation with a bonded directional seed.
contract VaultDriver is SharedDriverUtils {
    uint256 internal constant SEED_ACCOUNT_BIT = 1 << 127;

    Protocol public immutable protocol;

    uint32 public driverId;
    uint64 public nextPoolId = 1;
    mapping(bytes32 => mapping(Side => uint64)) public poolIdOf;
    mapping(bytes32 => mapping(address => SeedLane)) public seeds;

    struct SeedLane {
        Side side;
        uint256 rate;
        bool active;
    }

    event StreamingSet(address indexed drips, address indexed usdc, uint32 driverId);
    event VaultCreated(bytes32 indexed marketId, bytes32 indexed vaultId, address indexed creator, string question);
    event SeedOpened(
        bytes32 indexed vaultId, address indexed creator, Side side, uint256 rate, uint256 deposit, uint32 maxEnd
    );
    event SeedStopped(bytes32 indexed vaultId, address indexed creator, Side side);

    constructor(Protocol protocol_, address drips_, address forwarder, IERC20 usdc_)
        SharedDriverUtils(IDrips(drips_), forwarder, usdc_)
    {
        require(address(protocol_) != address(0), "VaultDriver: zero protocol");
        protocol = protocol_;
    }

    modifier onlyFundingDriver() {
        require(msg.sender == protocol.marketDriver() || msg.sender == address(this), "VaultDriver: not funding driver");
        _;
    }

    /// @notice Register as the Drips receiver driver. Must run before the MarketDriver slot is reserved.
    function bootstrapStreaming() external {
        require(driverId == 0, "VaultDriver: streaming already bootstrapped");
        driverId = DRIPS.registerDriver(address(this));
        emit StreamingSet(address(DRIPS), address(USDC), driverId);
    }

    /// @notice Permissionless vault creation under an existing market with a mandatory directional seed.
    function createVault(bytes32 marketId, string calldata question, Side seedSide, uint256 rate, uint256 deposit)
        external
        returns (bytes32 vaultId)
    {
        require(rate > 0, "VaultDriver: zero rate");
        require(deposit > 0 && deposit <= uint256(uint128(type(int128).max)), "VaultDriver: bad deposit");
        require(IMarketRegistry(protocol.marketRegistry()).marketExists(marketId), "VaultDriver: unknown market");

        address creator = _msgSender();
        Vault vault = Vault(protocol.vault());

        vaultId = vault.createVault(marketId, question, creator);
        IMarketRegistry(protocol.marketRegistry()).addVault(marketId, vaultId);
        emit VaultCreated(marketId, vaultId, creator, question);

        require(!seeds[vaultId][creator].active, "VaultDriver: seed exists");

        uint256 account = seedAccount(creator, vaultId);
        uint256 receiver = _assignReceiver(vaultId, seedSide);

        StreamReceiver[] memory recv = new StreamReceiver[](1);
        recv[0] =
            StreamReceiver({accountId: receiver, config: StreamConfigImpl.create(0, uint160(rate * AMT_MUL), 0, 0)});

        _transferFromCaller(USDC, uint128(deposit));
        DRIPS.setStreams(account, USDC, new StreamReceiver[](0), int128(uint128(deposit)), recv, 0, 0);
        (,,,, uint32 maxEnd) = DRIPS.streamsState(account, USDC);

        vault.onFund(account, vaultId, seedSide, rate, maxEnd);
        seeds[vaultId][creator] = SeedLane({side: seedSide, rate: rate, active: true});

        emit SeedOpened(vaultId, creator, seedSide, rate, deposit, maxEnd);
    }

    function stopSeed(bytes32 vaultId) external returns (uint256 refunded) {
        address creator = _msgSender();
        SeedLane memory lane = seeds[vaultId][creator];
        require(lane.active, "VaultDriver: no seed");

        uint256 account = seedAccount(creator, vaultId);
        uint256 receiver = receiverAccountView(vaultId, lane.side);
        StreamReceiver[] memory curr = new StreamReceiver[](1);
        curr[0] = StreamReceiver({
            accountId: receiver, config: StreamConfigImpl.create(0, uint160(lane.rate * AMT_MUL), 0, 0)
        });

        // Withdraw the entire remaining balance (refund the unstreamed bond) and stop the stream —
        // without this the unspent seed would be permanently stranded in Drips. The delivered portion
        // stays as the seed's Board position (onStop banks its shares + loss basis).
        int128 realDelta = DRIPS.setStreams(account, USDC, curr, type(int128).min, new StreamReceiver[](0), 0, 0);
        Vault(protocol.vault()).onStop(account, vaultId, lane.side);
        seeds[vaultId][creator].active = false;

        if (realDelta < 0) {
            refunded = uint256(uint128(-realDelta));
            DRIPS.withdraw(USDC, creator, refunded);
        }
        emit SeedStopped(vaultId, creator, lane.side);
    }

    function withdraw(bytes32 vaultId) external returns (uint256 payout) {
        address creator = _msgSender();
        return Vault(protocol.vault()).withdraw(seedAccount(creator, vaultId), vaultId, creator);
    }

    /// @notice The Drips sender account for a creator's seed on `vaultId` (distinct from MarketDriver NFT accounts).
    function seedAccount(address creator, bytes32 vaultId) public view returns (uint256 account) {
        uint128 tag = uint128(uint256(keccak256(abi.encodePacked("livestreak.seed", creator, vaultId))));
        return (uint256(driverId) << 224) | SEED_ACCOUNT_BIT | uint256(tag);
    }

    /// @notice The Drips receiver account for a (vault, side); assigns a poolId on first use.
    function receiverAccount(bytes32 vaultId, Side side) external onlyFundingDriver returns (uint256) {
        return _assignReceiver(vaultId, side);
    }

    function receiverAccountView(bytes32 vaultId, Side side) public view returns (uint256) {
        return _receiverAccount(poolIdOf[vaultId][side]);
    }

    /// @notice Bank a vault-side's delivered USDC into the Vault. Permissionless and idempotent.
    function harvest(bytes32 vaultId, Side side) external returns (uint256) {
        uint64 pid = poolIdOf[vaultId][side];
        if (pid == 0) return 0;
        uint256 receiver = _receiverAccount(pid);
        DRIPS.receiveStreams(receiver, USDC, type(uint32).max);
        uint128 amt = DRIPS.collect(receiver, USDC);
        if (amt > 0) DRIPS.withdraw(USDC, protocol.vault(), amt);
        return uint256(amt);
    }

    function usdc() external view returns (IERC20) {
        return USDC;
    }

    function _callerAccountId() internal view override returns (uint256) {
        revert("VaultDriver: no caller account");
    }

    function _assignReceiver(bytes32 vaultId, Side side) internal returns (uint256) {
        (,,,,,,, bool exists) = Vault(protocol.vault()).vaults(vaultId);
        require(exists, "VaultDriver: unknown vault");
        uint64 pid = poolIdOf[vaultId][side];
        if (pid == 0) {
            pid = nextPoolId++;
            poolIdOf[vaultId][side] = pid;
        }
        return _receiverAccount(pid);
    }

    function _receiverAccount(uint64 poolId) internal view returns (uint256) {
        require(poolId != 0, "VaultDriver: unassigned pool");
        return (uint256(driverId) << 224) | uint256(poolId);
    }
}
