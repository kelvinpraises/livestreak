// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {Context} from "openzeppelin-contracts/utils/Context.sol";
import {ERC2771Context} from "openzeppelin-contracts/metatx/ERC2771Context.sol";
import {ERC721, ERC721URIStorage, IERC721} from "openzeppelin-contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC721Enumerable} from "openzeppelin-contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {StreamReceiver, StreamConfigImpl} from "../Streams.sol";
import {Managed} from "../Managed.sol";
import {SharedDriverUtils} from "./SharedDriverUtils.sol";
import {VaultDriver} from "./VaultDriver.sol";
import {IDrips} from "../IDrips.sol";
import {Protocol} from "../../Protocol.sol";
import {Vault} from "../../vault/Vault.sol";
import {Side} from "../../vault/Side.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";

interface IMarketRegistry {
    function marketExists(bytes32 marketId) external view returns (bool);
}

interface ITreasuryLoss {
    function mintLossLvst(uint256 account, address to, bytes32 vaultId, Side side) external returns (uint256);
}

/// @notice Per-market NFT driver: one tokenId == one Drips account, ≤MAX_LANES concurrent lanes —
/// one lane per vault (a held vault streams YES or NO, never both; hedge by flipping a vault's side in
/// `setLanes`, the single declarative lane-set op).
/// The lane ceiling is naturally the market's vault count (you cannot fund a vault that does not
/// exist), hard-capped at MAX_LANES so the shared-balance maxEnd refresh stays bounded.
contract MarketDriver is SharedDriverUtils, ERC721Enumerable, ERC721URIStorage, Managed {
    uint32 public immutable DRIVER_ID;
    Protocol public immutable PROTOCOL;
    Vault public immutable VAULT;
    VaultDriver public immutable VAULT_DRIVER;

    /// @notice Hard ceiling on concurrent lanes (distinct vaults) per NFT — bounds refresh gas.
    uint8 public constant MAX_LANES = 10;

    uint64 internal _mintedTokens;
    mapping(address => mapping(uint64 => bool)) internal _isSaltUsed;

    mapping(uint256 => bytes32) public marketIdOf;
    mapping(uint256 => bytes32[]) internal _laneKeys;
    mapping(uint256 => mapping(bytes32 => Lane)) internal _lanes;

    struct Lane {
        bytes32 vaultId;
        Side side;
        uint256 rate;
    }

    event MarketNftMinted(uint256 indexed tokenId, bytes32 indexed marketId, address indexed to);
    event LaneFunded(
        uint256 indexed tokenId, bytes32 indexed vaultId, Side side, uint256 rate, uint256 deposit, uint32 maxEnd
    );
    event LaneStopped(uint256 indexed tokenId, bytes32 indexed vaultId, Side side);
    event AllLanesStopped(uint256 indexed tokenId, uint256 refunded);

    constructor(
        address drips_,
        address forwarder,
        uint32 driverId_,
        Protocol protocol_,
        Vault vault_,
        VaultDriver vaultDriver_,
        address usdc_
    ) SharedDriverUtils(IDrips(drips_), forwarder, IERC20(usdc_)) ERC721("", "") {
        DRIVER_ID = driverId_;
        PROTOCOL = protocol_;
        VAULT = vault_;
        VAULT_DRIVER = vaultDriver_;
    }

    modifier onlyHolder(uint256 tokenId) {
        require(_isApprovedOrOwner(_msgSender(), tokenId), "MarketDriver: not holder");
        _;
    }

    // --- exports ---

    function nextTokenId() public view returns (uint256 tokenId) {
        return _calcTokenIdWithSalt(address(0), _mintedTokens);
    }

    function calcTokenIdWithSalt(address minter, uint64 salt) public view returns (uint256 tokenId) {
        return _calcTokenIdWithSalt(minter, salt);
    }

    function isSaltUsed(address minter, uint64 salt) external view returns (bool) {
        return _isSaltUsed[minter][salt];
    }

    function laneCount(uint256 tokenId) public view returns (uint256) {
        return _laneKeys[tokenId].length;
    }

    function laneAt(uint256 tokenId, uint256 index) external view returns (bytes32 vaultId, Side side, uint256 rate) {
        bytes32 key = _laneKeys[tokenId][index];
        Lane storage lane = _lanes[tokenId][key];
        return (lane.vaultId, lane.side, lane.rate);
    }

    /// @notice Every tokenId currently owned by `owner` (includes NFTs transferred in).
    function tokensOfOwner(address owner) external view returns (uint256[] memory tokenIds) {
        uint256 n = balanceOf(owner);
        tokenIds = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            tokenIds[i] = tokenOfOwnerByIndex(owner, i);
        }
    }

    function mint(bytes32 marketId_, address to) external whenNotPaused returns (uint256 tokenId) {
        require(IMarketRegistry(PROTOCOL.marketRegistry()).marketExists(marketId_), "MarketDriver: unknown market");
        tokenId = _registerTokenId();
        marketIdOf[tokenId] = marketId_;
        _mint(to, tokenId);
        emit MarketNftMinted(tokenId, marketId_, to);
    }

    function mintWithSalt(bytes32 marketId_, uint64 salt, address to) external whenNotPaused returns (uint256 tokenId) {
        require(IMarketRegistry(PROTOCOL.marketRegistry()).marketExists(marketId_), "MarketDriver: unknown market");
        tokenId = _registerTokenIdWithSalt(salt);
        marketIdOf[tokenId] = marketId_;
        _mint(to, tokenId);
        emit MarketNftMinted(tokenId, marketId_, to);
    }

    function fund(uint256 tokenId, bytes32 vaultId, Side side, uint256 rate, uint256 deposit)
        external
        onlyHolder(tokenId)
        whenNotPaused
    {
        require(rate > 0, "MarketDriver: zero rate");
        require(deposit > 0 && deposit <= uint256(uint128(type(int128).max)), "MarketDriver: bad deposit");
        require(VAULT.marketId(vaultId) == marketIdOf[tokenId], "MarketDriver: wrong market");
        bytes32 key = vaultId; // one lane per vault: a held vault streams YES or NO, never both
        require(_lanes[tokenId][key].rate == 0, "MarketDriver: vault already has a lane");
        require(_laneKeys[tokenId].length < MAX_LANES, "MarketDriver: too many lanes");

        StreamReceiver[] memory curr = _buildReceivers(tokenId);
        _laneKeys[tokenId].push(key);
        _lanes[tokenId][key] = Lane({vaultId: vaultId, side: side, rate: rate});

        StreamReceiver[] memory next = _buildReceivers(tokenId);
        _transferFromCaller(USDC, uint128(deposit));
        DRIPS.setStreams(tokenId, USDC, curr, int128(uint128(deposit)), next, 0, 0);
        (,,,, uint32 maxEnd) = DRIPS.streamsState(tokenId, USDC);

        VAULT.onFund(tokenId, vaultId, side, rate, maxEnd);
        _refreshOtherLanes(tokenId, vaultId, maxEnd);

        emit LaneFunded(tokenId, vaultId, side, rate, deposit, maxEnd);
    }

    function stop(uint256 tokenId, bytes32 vaultId, Side side) external onlyHolder(tokenId) whenNotPaused {
        bytes32 key = vaultId;
        Lane storage lane = _lanes[tokenId][key];
        require(lane.rate > 0 && lane.side == side, "MarketDriver: no lane");

        StreamReceiver[] memory curr = _buildReceivers(tokenId);
        _removeLane(tokenId, key);
        StreamReceiver[] memory next = _buildReceivers(tokenId);

        DRIPS.setStreams(tokenId, USDC, curr, 0, next, 0, 0);
        VAULT.onStop(tokenId, vaultId, side);
        (,,,, uint32 maxEnd) = DRIPS.streamsState(tokenId, USDC);
        if (_laneKeys[tokenId].length > 0) {
            _refreshAllLanes(tokenId, maxEnd);
        }

        emit LaneStopped(tokenId, vaultId, side);
    }

    /// @notice The single lane-management op: declaratively set this NFT's whole lane set in one tx.
    /// Diffs `desired` against the current lanes — any lane no longer present (a dropped vault, or one
    /// whose side or rate changed) is stopped, its accrued shares surviving on its Board for later
    /// claim; any new or changed lane is opened at the *current* curve price. A hedge is just the same
    /// vault carrying the other side in `desired` (stop YES, start NO — "suffer late incoming"). Reverts
    /// if `desired` exceeds MAX_LANES or repeats a vault; no entry is ever silently dropped. So
    /// "a s d f g h j k e w" over "a s d f g h j k l q" stops l,q and opens e,w, and an 11-entry set
    /// reverts on the spot. Pass `addDeposit > 0` to top up the shared balance.
    function setLanes(uint256 tokenId, Lane[] calldata desired, uint256 addDeposit)
        external
        onlyHolder(tokenId)
        whenNotPaused
    {
        require(desired.length <= MAX_LANES, "MarketDriver: too many lanes");
        require(addDeposit <= uint256(uint128(type(int128).max)), "MarketDriver: bad deposit");
        bytes32 market = marketIdOf[tokenId];

        for (uint256 i = 0; i < desired.length; i++) {
            require(desired[i].rate > 0, "MarketDriver: zero rate");
            require(VAULT.marketId(desired[i].vaultId) == market, "MarketDriver: wrong market");
            for (uint256 j = 0; j < i; j++) {
                require(desired[i].vaultId != desired[j].vaultId, "MarketDriver: duplicate vault in set");
            }
        }

        StreamReceiver[] memory curr = _buildReceivers(tokenId);

        // Removed = current lanes with no exact (vault+side+rate) match in `desired` — captured before
        // the bookkeeping rewrite. Covers a dropped vault and a vault whose side or rate changed.
        bytes32[] memory currentKeys = _laneKeys[tokenId];
        bytes32[] memory removedVaults = new bytes32[](currentKeys.length);
        Side[] memory removedSides = new Side[](currentKeys.length);
        uint256 removedN;
        for (uint256 i = 0; i < currentKeys.length; i++) {
            Lane memory cl = _lanes[tokenId][currentKeys[i]];
            if (!_exactlyIn(desired, cl)) {
                removedVaults[removedN] = cl.vaultId;
                removedSides[removedN] = cl.side;
                removedN++;
            }
        }

        // Added = desired lanes with no exact match among current lanes (new vault, or changed side/rate).
        bytes32[] memory addedVaults = new bytes32[](desired.length);
        Side[] memory addedSides = new Side[](desired.length);
        uint256[] memory addedRates = new uint256[](desired.length);
        uint256 addedN;
        for (uint256 k = 0; k < desired.length; k++) {
            Lane memory held = _lanes[tokenId][desired[k].vaultId];
            if (held.rate != desired[k].rate || held.side != desired[k].side) {
                addedVaults[addedN] = desired[k].vaultId;
                addedSides[addedN] = desired[k].side;
                addedRates[addedN] = desired[k].rate;
                addedN++;
            }
        }

        // Rewrite lane bookkeeping to exactly `desired`.
        for (uint256 i = 0; i < currentKeys.length; i++) {
            delete _lanes[tokenId][currentKeys[i]];
        }
        delete _laneKeys[tokenId];
        bytes32[] memory allVaults = new bytes32[](desired.length);
        Side[] memory allSides = new Side[](desired.length);
        for (uint256 k = 0; k < desired.length; k++) {
            _laneKeys[tokenId].push(desired[k].vaultId);
            _lanes[tokenId][desired[k].vaultId] =
                Lane({vaultId: desired[k].vaultId, side: desired[k].side, rate: desired[k].rate});
            allVaults[k] = desired[k].vaultId;
            allSides[k] = desired[k].side;
        }

        StreamReceiver[] memory next = _buildReceivers(tokenId);
        if (addDeposit > 0) _transferFromCaller(USDC, uint128(addDeposit));
        DRIPS.setStreams(tokenId, USDC, curr, int128(uint128(addDeposit)), next, 0, 0);
        (,,,, uint32 maxEnd) = DRIPS.streamsState(tokenId, USDC);

        // Stop removed (banks their shares) before opening added, so a same-vault side flip settles its
        // old side before the new one opens.
        for (uint256 i = 0; i < removedN; i++) {
            VAULT.onStop(tokenId, removedVaults[i], removedSides[i]);
            emit LaneStopped(tokenId, removedVaults[i], removedSides[i]);
        }
        for (uint256 i = 0; i < addedN; i++) {
            VAULT.onFund(tokenId, addedVaults[i], addedSides[i], addedRates[i], maxEnd);
            emit LaneFunded(tokenId, addedVaults[i], addedSides[i], addedRates[i], 0, maxEnd);
        }
        // Re-peg every desired lane to the new shared maxEnd (just-opened lanes are already there -> no-op).
        if (desired.length > 0) {
            VAULT.refreshMaxEnds(tokenId, allVaults, allSides, maxEnd);
        }
    }

    /// @dev True iff `lane` (vault + side + rate) appears exactly in `set`.
    function _exactlyIn(Lane[] calldata set, Lane memory lane) private pure returns (bool) {
        for (uint256 i = 0; i < set.length; i++) {
            if (set[i].vaultId == lane.vaultId && set[i].side == lane.side && set[i].rate == lane.rate) {
                return true;
            }
        }
        return false;
    }

    function stopAll(uint256 tokenId) external onlyHolder(tokenId) {
        StreamReceiver[] memory curr = _buildReceivers(tokenId);
        bytes32[] memory keys = _laneKeys[tokenId];
        for (uint256 i = 0; i < keys.length; i++) {
            Lane memory lane = _lanes[tokenId][keys[i]];
            VAULT.onStop(tokenId, lane.vaultId, lane.side);
            delete _lanes[tokenId][keys[i]];
        }
        delete _laneKeys[tokenId];

        int128 realDelta = DRIPS.setStreams(tokenId, USDC, curr, type(int128).min, new StreamReceiver[](0), 0, 0);
        uint256 refunded;
        if (realDelta < 0) {
            refunded = uint256(uint128(-realDelta));
            DRIPS.withdraw(USDC, _msgSender(), refunded);
        }
        emit AllLanesStopped(tokenId, refunded);
    }

    /// @notice Pull winnings + overage for one vault. Pays `to`, or the NFT owner when `to == 0`.
    function withdraw(uint256 tokenId, bytes32 vaultId, address to)
        external
        onlyHolder(tokenId)
        returns (uint256 payout)
    {
        return VAULT.withdraw(tokenId, vaultId, _payee(tokenId, to));
    }

    /// @notice Pull winnings + overage for many vaults in one call (the mass form). Same `to` rule;
    /// the frontend builds `vaultIds` from `VAULT.getAccountVaultIds(tokenId)`.
    function withdraw(uint256 tokenId, bytes32[] calldata vaultIds, address to)
        external
        onlyHolder(tokenId)
        returns (uint256 total)
    {
        address payee = _payee(tokenId, to);
        for (uint256 i = 0; i < vaultIds.length; i++) {
            total += VAULT.withdraw(tokenId, vaultIds[i], payee);
        }
    }

    function claimLossLvst(uint256 tokenId, bytes32 vaultId, Side side, address to)
        external
        onlyHolder(tokenId)
        returns (uint256 minted)
    {
        address treasury = PROTOCOL.treasury();
        require(treasury != address(0), "MarketDriver: treasury unset");
        return ITreasuryLoss(treasury).mintLossLvst(tokenId, _payee(tokenId, to), vaultId, side);
    }

    /// @dev Payout recipient: the NFT owner by default; only the owner may redirect elsewhere — an
    /// approved operator can trigger a payout to the owner but cannot siphon it to another address.
    function _payee(uint256 tokenId, address to) internal view returns (address) {
        address owner = ownerOf(tokenId);
        if (to == address(0) || to == owner) return owner;
        require(_msgSender() == owner, "MarketDriver: only owner can redirect");
        return to;
    }

    // --- helpers ---

    function _callerAccountId() internal view override returns (uint256) {
        revert("MarketDriver: no caller account");
    }

    function _calcTokenIdWithSalt(address minter, uint64 salt) internal view returns (uint256 tokenId) {
        tokenId = DRIVER_ID;
        tokenId = (tokenId << 160) | uint160(minter);
        tokenId = (tokenId << 64) | uint256(salt);
    }

    function _registerTokenId() internal returns (uint256 tokenId) {
        tokenId = nextTokenId();
        _mintedTokens++;
    }

    function _registerTokenIdWithSalt(uint64 salt) internal returns (uint256 tokenId) {
        address minter = _msgSender();
        require(!_isSaltUsed[minter][salt], "MarketDriver: salt used");
        _isSaltUsed[minter][salt] = true;
        return _calcTokenIdWithSalt(minter, salt);
    }

    function _removeLane(uint256 tokenId, bytes32 key) internal {
        bytes32[] storage keys = _laneKeys[tokenId];
        uint256 len = keys.length;
        for (uint256 i = 0; i < len; i++) {
            if (keys[i] == key) {
                keys[i] = keys[len - 1];
                keys.pop();
                delete _lanes[tokenId][key];
                return;
            }
        }
    }

    function _buildReceivers(uint256 tokenId) internal returns (StreamReceiver[] memory receivers) {
        bytes32[] storage keys = _laneKeys[tokenId];
        uint256 n = keys.length;
        receivers = new StreamReceiver[](n);
        for (uint256 i = 0; i < n; i++) {
            Lane storage lane = _lanes[tokenId][keys[i]];
            uint256 recv = VAULT_DRIVER.receiverAccount(lane.vaultId, lane.side);
            receivers[i] = StreamReceiver({
                accountId: recv, config: StreamConfigImpl.create(0, uint160(lane.rate * AMT_MUL), 0, 0)
            });
        }
        _sortReceivers(receivers);
    }

    function _sortReceivers(StreamReceiver[] memory receivers) internal pure {
        uint256 n = receivers.length;
        for (uint256 i = 1; i < n; i++) {
            StreamReceiver memory x = receivers[i];
            uint256 j = i;
            while (j > 0 && receivers[j - 1].accountId > x.accountId) {
                receivers[j] = receivers[j - 1];
                j--;
            }
            receivers[j] = x;
        }
    }

    function _refreshOtherLanes(uint256 tokenId, bytes32 newVaultId, uint32 maxEnd) internal {
        bytes32[] storage keys = _laneKeys[tokenId];
        uint256 n = keys.length;
        if (n <= 1) return;
        bytes32 newKey = newVaultId;
        bytes32[] memory vaultIds = new bytes32[](n - 1);
        Side[] memory sides = new Side[](n - 1);
        uint256 j;
        for (uint256 i = 0; i < n; i++) {
            bytes32 key = keys[i];
            if (key == newKey) continue;
            Lane storage lane = _lanes[tokenId][key];
            vaultIds[j] = lane.vaultId;
            sides[j] = lane.side;
            j++;
        }
        VAULT.refreshMaxEnds(tokenId, vaultIds, sides, maxEnd);
    }

    function _refreshAllLanes(uint256 tokenId, uint32 maxEnd) internal {
        bytes32[] storage keys = _laneKeys[tokenId];
        uint256 n = keys.length;
        bytes32[] memory vaultIds = new bytes32[](n);
        Side[] memory sides = new Side[](n);
        for (uint256 i = 0; i < n; i++) {
            Lane storage lane = _lanes[tokenId][keys[i]];
            vaultIds[i] = lane.vaultId;
            sides[i] = lane.side;
        }
        VAULT.refreshMaxEnds(tokenId, vaultIds, sides, maxEnd);
    }

    function _beforeTokenTransfer(address from, address to, uint256 firstTokenId, uint256 batchSize)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._beforeTokenTransfer(from, to, firstTokenId, batchSize);
    }

    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Enumerable, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
