// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {Side} from "./Side.sol";
import {BondingBoard} from "./BondingBoard.sol";
import {Protocol} from "../Protocol.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";

/// @dev Treasury house-pot sink: the Vault skims a slice of the bounty here at resolution.
interface ITreasurySkim {
    function skimBps() external view returns (uint256);
    function notifySkim(uint256 amount) external;
}

/// @dev Receiver-side Drips harvest surface.
interface IVaultDriver {
    function harvest(bytes32 vaultId, Side side) external returns (uint256);
    function usdc() external view returns (IERC20);
}

/// @title Vault — binary YES/NO pool state under one market, with the streamed-funding Board.
///
/// @notice Owns per-side pricing (the Board), per-funder positions, and the resolution skeleton.
/// Funding flows in as USDC streams (via the per-market MarketDriver), priced fairly on the
/// bonding curve through one cumulative index `g` per (vault, side). Delivered USDC is harvested
/// into the Vault at resolution via `VaultDriver`.
///
/// @dev Board math is `BondingBoard`. Design: docs/streamed-funding-explained.md. Resolution
/// (collect / claimFor payout) is the next slice — see the marked section at the bottom.
contract Vault {
    using SafeERC20 for IERC20;

    Protocol public immutable protocol;

    uint256 public constant BASE_PRICE = 100_000; // 1e5 (mirrors BondingBoard)
    uint256 public constant CURVE_K = 10_000e6; // 1e10
    uint256 internal constant SHARE_SCALE = 1e6;
    uint256 internal constant WAD = 1e18;

    /// @notice Max depletion boundaries processed per advance (flood / no-brick bound).
    uint256 public constant MAX_STEPS = 64;

    enum Status {
        Open,
        Hot,
        Locked,
        Resolved,
        Disputed
    }

    enum Outcome {
        Pending,
        Yes,
        No
    }

    struct VaultData {
        bytes32 id;
        bytes32 marketId;
        string question;
        address creator;
        Status status;
        Outcome outcome;
        uint32 resolvedAt;
        bool exists;
    }

    struct Board {
        uint256 pool; // side pool = scheduled USDC delivered (6-dec units)
        uint256 sideRate; // sum of active funder rates (USDC-units/sec)
        uint256 g; // WAD shares-per-unit-rate index
        uint32 lastAdvance; // timestamp the Board is current as-of (0 = never funded)
        uint256 sideShares; // WAD·SCALE sum of all positions' accrued shares
    }

    struct Position {
        uint256 rate; // USDC-units/sec; 0 once stopped or depleted
        uint256 gPaid; // WAD value of `g` at last settle
        uint256 sharesAccrued; // WAD·SCALE; floor(÷1e18) = SHARE_SCALE-scaled shares
        uint32 maxEnd; // Drips run-dry time for this funder's stream
        bool depleted; // settled at its depletion boundary
        uint32 fundStart; // timestamp this position's current stream began (for loss-USDC)
        uint256 lostUsdc; // USDC streamed into this side by closed (stopped/depleted) streams, banked
    }

    struct Boundary {
        uint32 maxEnd;
        uint256 account;
    }

    address public marketDriver;
    address public resolver; // the steward path authorized to set outcomes
    IERC20 public usdc;
    IVaultDriver public vaultDriver;

    uint256 private _nonce;

    mapping(bytes32 => VaultData) public vaults;
    mapping(bytes32 => mapping(Side => Board)) internal _boards;
    mapping(bytes32 => mapping(Side => mapping(uint256 => Position))) internal _positions;
    mapping(bytes32 => mapping(Side => Boundary[])) internal _boundaries;
    mapping(bytes32 => mapping(Side => uint256)) internal _boundaryHead;

    mapping(bytes32 => uint256) public pot; // USDC the winning side splits (Board truth at resolvedAt)
    mapping(bytes32 => bool) public collected;
    mapping(bytes32 => mapping(Side => mapping(uint256 => bool))) public claimed;
    mapping(bytes32 => mapping(Side => mapping(uint256 => uint256))) public overageOwed;
    mapping(bytes32 => mapping(Side => mapping(uint256 => uint256))) public overagePaid;
    mapping(uint256 => bytes32[]) private _accountVaults;
    mapping(uint256 => mapping(bytes32 => bool)) private _accountInVault;

    ITreasurySkim public treasury; // house pot; receives the winner-skim at resolution (0 = skim off)
    mapping(bytes32 => uint256) public skimOwed; // skim computed at first collect, flushed once cash is in

    event VaultOpened(bytes32 indexed vaultId, bytes32 indexed marketId, address indexed creator, string question);
    event VaultResolved(bytes32 indexed vaultId, Outcome outcome);
    event MarketDriverSet(address indexed marketDriver);
    event ResolverSet(address indexed resolver);
    event VaultDriverSet(address indexed vaultDriver);
    event TreasurySet(address indexed treasury);
    event Skimmed(bytes32 indexed vaultId, uint256 amount);
    event Funded(bytes32 indexed vaultId, Side indexed side, uint256 indexed account, uint256 rate, uint32 maxEnd);
    event Stopped(bytes32 indexed vaultId, Side indexed side, uint256 indexed account, uint256 sharesAccrued);
    event Collected(bytes32 indexed vaultId, uint256 pot);
    event Claimed(bytes32 indexed vaultId, Side indexed side, uint256 indexed account, uint256 shares, uint256 payout);
    event OverageRecorded(bytes32 indexed vaultId, Side indexed side, uint256 indexed account, uint256 amount);
    event OverageReclaimed(bytes32 indexed vaultId, Side indexed side, uint256 indexed account, uint256 amount);
    event Withdrawn(bytes32 indexed vaultId, uint256 indexed account, address indexed payee, uint256 amount);

    constructor(Protocol protocol_) {
        require(address(protocol_) != address(0), "Vault: zero protocol");
        protocol = protocol_;
    }

    modifier onlyVaultDriver() {
        require(msg.sender == address(vaultDriver), "Vault: not vault driver");
        _;
    }

    modifier onlyFundingDriver() {
        require(msg.sender == marketDriver || msg.sender == address(vaultDriver), "Vault: not funding driver");
        _;
    }

    modifier onlyResolver() {
        require(msg.sender == resolver, "Vault: not resolver");
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              WIRING
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice One-shot cache of sibling module addresses from Protocol after streaming is wired.
    function syncFromProtocol() external {
        require(marketDriver == address(0), "Vault: already synced");

        address vaultDriver_ = protocol.vaultDriver();
        address marketDriver_ = protocol.marketDriver();
        address resolver_ = protocol.stewardRegistry();
        address treasury_ = protocol.treasury();
        require(
            vaultDriver_ != address(0) && marketDriver_ != address(0) && resolver_ != address(0),
            "Vault: protocol incomplete"
        );

        marketDriver = marketDriver_;
        resolver = resolver_;
        vaultDriver = IVaultDriver(vaultDriver_);
        usdc = vaultDriver.usdc();
        if (treasury_ != address(0)) {
            treasury = ITreasurySkim(treasury_);
            emit TreasurySet(treasury_);
        }

        emit MarketDriverSet(marketDriver_);
        emit ResolverSet(resolver_);
        emit VaultDriverSet(vaultDriver_);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          VAULT LIFECYCLE
    // ═══════════════════════════════════════════════════════════════════════

    function createVault(bytes32 marketId, string calldata question, address creator)
        external
        onlyVaultDriver
        returns (bytes32 vaultId)
    {
        require(bytes(question).length > 0, "Vault: empty question");
        require(creator != address(0), "Vault: zero creator");

        vaultId = keccak256(abi.encodePacked(marketId, question, _nonce++, block.timestamp));

        vaults[vaultId] = VaultData({
            id: vaultId,
            marketId: marketId,
            question: question,
            creator: creator,
            status: Status.Open,
            outcome: Outcome.Pending,
            resolvedAt: 0,
            exists: true
        });

        emit VaultOpened(vaultId, marketId, creator, question);
    }

    function vaultExists(bytes32 vaultId) external view returns (bool) {
        return vaults[vaultId].exists;
    }

    function getVault(bytes32 vaultId) external view returns (VaultData memory) {
        require(vaults[vaultId].exists, "Vault: unknown vault");
        return vaults[vaultId];
    }

    /// @notice Set the binary outcome. Gated to the `resolver` (the `StewardRegistry` steward path) —
    /// the factory deliberately cannot resolve, since it has no view of the real-world result.
    function resolve(bytes32 vaultId, Outcome outcome) external onlyResolver {
        VaultData storage data = vaults[vaultId];
        require(data.exists, "Vault: unknown vault");
        require(data.status == Status.Open || data.status == Status.Locked, "Vault: not resolvable");
        require(outcome == Outcome.Yes || outcome == Outcome.No, "Vault: invalid outcome");

        data.status = Status.Resolved;
        data.outcome = outcome;
        data.resolvedAt = uint32(block.timestamp);
        emit VaultResolved(vaultId, outcome);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                       FUNDING HOOKS (driver-only)
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Open a funder's position after the driver has set the real Drips stream.
    function onFund(uint256 account, bytes32 vaultId, Side side, uint256 rate, uint32 maxEnd)
        external
        onlyFundingDriver
    {
        require(vaults[vaultId].status == Status.Open, "Vault: not open");
        require(rate > 0, "Vault: zero rate");

        if (!_accountInVault[account][vaultId]) {
            _accountInVault[account][vaultId] = true;
            _accountVaults[account].push(vaultId);
        }

        _advanceToNow(vaultId, side);
        _settle(vaultId, side, account);

        Position storage p = _positions[vaultId][side][account];
        require(p.rate == 0 && !p.depleted, "Vault: already funding");

        Board storage b = _boards[vaultId][side];
        p.rate = rate;
        p.gPaid = b.g;
        p.maxEnd = maxEnd;
        p.fundStart = uint32(block.timestamp);
        b.sideRate += rate;
        _scheduleBoundary(vaultId, side, maxEnd, account);

        emit Funded(vaultId, side, account, rate, maxEnd);
    }

    /// @notice Close a funder's position; banks accrued shares and drops the rate.
    function onStop(uint256 account, bytes32 vaultId, Side side) external onlyFundingDriver {
        _advanceToNow(vaultId, side);
        _settle(vaultId, side, account);

        Position storage p = _positions[vaultId][side][account];
        if (p.rate > 0 && !p.depleted) {
            uint32 resolvedAt = vaults[vaultId].resolvedAt;

            // Bank this stream's USDC up to stop, capped at resolvedAt — the loss basis for LVST.
            uint256 lossEnd = uint256(p.maxEnd) < block.timestamp ? uint256(p.maxEnd) : block.timestamp;
            if (resolvedAt != 0 && uint256(resolvedAt) < lossEnd) lossEnd = uint256(resolvedAt);
            if (lossEnd > p.fundStart) p.lostUsdc += p.rate * (lossEnd - uint256(p.fundStart));

            // USDC streamed AFTER resolution is not part of the pot (the Board froze at resolvedAt);
            // record it as a refund the funder can reclaim, so they aren't penalised for over-streaming.
            if (resolvedAt != 0 && block.timestamp > resolvedAt) {
                uint256 overEnd = uint256(p.maxEnd) < block.timestamp ? uint256(p.maxEnd) : block.timestamp;
                if (overEnd > resolvedAt) {
                    uint256 over = p.rate * (overEnd - uint256(resolvedAt));
                    overageOwed[vaultId][side][account] += over;
                    emit OverageRecorded(vaultId, side, account, over);
                }
            }
            _boards[vaultId][side].sideRate -= p.rate;
            p.rate = 0; // its scheduled boundary becomes stale (rate 0 → skipped on advance)
        }
        emit Stopped(vaultId, side, account, p.sharesAccrued);
    }

    /// @notice Re-peg active lanes' `maxEnd` after a sibling lane changes the shared Drips balance.
    function refreshMaxEnds(uint256 account, bytes32[] calldata vaultIds, Side[] calldata sides, uint32 newMaxEnd)
        external
        onlyFundingDriver
    {
        require(vaultIds.length == sides.length, "Vault: length mismatch");
        for (uint256 i = 0; i < vaultIds.length; i++) {
            bytes32 vaultId = vaultIds[i];
            Side side = sides[i];
            _advanceToNow(vaultId, side);
            _settle(vaultId, side, account);
            Position storage p = _positions[vaultId][side][account];
            if (p.rate > 0 && !p.depleted && newMaxEnd != p.maxEnd) {
                p.maxEnd = newMaxEnd;
                _scheduleBoundary(vaultId, side, newMaxEnd, account);
            }
        }
    }

    /// @notice Permissionless poke: catch the Board up, bounded by `maxSteps`.
    function advance(bytes32 vaultId, Side side, uint256 maxSteps) external {
        _advance(vaultId, side, maxSteps == 0 ? MAX_STEPS : maxSteps);
    }

    /// @notice Catch up then bank a funder's accrued shares at the current `g`.
    function settle(bytes32 vaultId, Side side, uint256 account) external {
        _advance(vaultId, side, MAX_STEPS);
        _settle(vaultId, side, account);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              READS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Shares `funder` would be credited if settled now (same math as settle; view-parity).
    function pendingShares(bytes32 vaultId, Side side, uint256 account) external view returns (uint256) {
        Position storage p = _positions[vaultId][side][account];
        uint256 capTs = block.timestamp;
        uint32 resolvedAt = vaults[vaultId].resolvedAt;
        if (resolvedAt != 0 && uint256(resolvedAt) < capTs) capTs = resolvedAt; // freeze at resolution
        if (!p.depleted && p.maxEnd != 0 && uint256(p.maxEnd) < capTs) {
            capTs = p.maxEnd; // accrual freezes at this funder's run-dry instant
        }
        uint256 gNow = _previewG(vaultId, side, capTs);
        uint256 accrued = p.sharesAccrued + p.rate * (gNow - p.gPaid);
        return accrued / WAD;
    }

    function getSharePrice(bytes32 vaultId, Side side) external view returns (uint256) {
        return BondingBoard.price(_boards[vaultId][side].pool);
    }

    function getVaultPools(bytes32 vaultId)
        external
        view
        returns (uint256 yesTotal, uint256 noTotal, uint256 yesShareTotal, uint256 noShareTotal)
    {
        require(vaults[vaultId].exists, "Vault: unknown vault");
        Board storage y = _boards[vaultId][Side.Yes];
        Board storage n = _boards[vaultId][Side.No];
        return (y.pool, n.pool, y.sideShares / WAD, n.sideShares / WAD);
    }

    function getBoard(bytes32 vaultId, Side side)
        external
        view
        returns (uint256 pool, uint256 sideRate, uint256 g, uint32 lastAdvance)
    {
        Board storage b = _boards[vaultId][side];
        return (b.pool, b.sideRate, b.g, b.lastAdvance);
    }

    function getPosition(bytes32 vaultId, Side side, uint256 account)
        external
        view
        returns (uint256 rate, uint256 gPaid, uint256 sharesAccrued, uint32 maxEnd, bool depleted)
    {
        Position storage p = _positions[vaultId][side][account];
        return (p.rate, p.gPaid, p.sharesAccrued, p.maxEnd, p.depleted);
    }

    function caughtUp(bytes32 vaultId, Side side) external view returns (bool) {
        return _boardCaughtUp(vaultId, side);
    }

    /// @notice Count of un-drained depletion boundaries on (vaultId, side). Lets a caller plan how many
    /// bounded `advance` calls precede a `fund` when the board is behind. `_boundaryHead <= length` always.
    function pendingBoundaries(bytes32 vaultId, Side side) external view returns (uint256) {
        return _boundaries[vaultId][side].length - _boundaryHead[vaultId][side];
    }

    function getAccountVaultIds(uint256 account) external view returns (bytes32[] memory) {
        return _accountVaults[account];
    }

    function marketId(bytes32 vaultId) external view returns (bytes32) {
        require(vaults[vaultId].exists, "Vault: unknown vault");
        return vaults[vaultId].marketId;
    }

    /// @notice The side that won. Reverts before resolution.
    function winningSide(bytes32 vaultId) external view returns (Side) {
        VaultData storage data = vaults[vaultId];
        require(data.status == Status.Resolved, "Vault: not resolved");
        return data.outcome == Outcome.Yes ? Side.Yes : Side.No;
    }

    /// @notice Preview `funder`'s USDC payout, view-parity with `claimFor` — `pot · shares / sideShares`
    /// without mutating. Returns 0 until resolved AND collected (the pot is final only after `collect`),
    /// and 0 for the losing side, a non-funder, or an already-claimed position. After `collect` the
    /// board sits at `resolvedAt`, so `b.g` is `G(resolvedAt)` and `b.sideShares` is final; this brings
    /// the funder's un-settled tail to the same point, in the same scaled units `claimFor` divides on.
    function claimable(uint256 account, bytes32 vaultId, Side side) external view returns (uint256) {
        VaultData storage data = vaults[vaultId];
        if (data.status != Status.Resolved || !collected[vaultId]) return 0;
        Side winning = data.outcome == Outcome.Yes ? Side.Yes : Side.No;
        if (side != winning || claimed[vaultId][side][account]) return 0;

        Board storage b = _boards[vaultId][side];
        if (b.sideShares == 0) return 0;
        Position storage p = _positions[vaultId][side][account];
        uint256 shares = p.sharesAccrued + p.rate * (b.g - p.gPaid);
        if (shares == 0) return 0;
        return FixedPointMathLib.fullMulDiv(pot[vaultId], shares, b.sideShares);
    }

    /// @notice USDC `funder` lost on the losing side — the basis they mint LVST against. 0 before
    /// resolution, for the winning side, or for a non-funder. Survives stop/deplete (banked in
    /// `lostUsdc`); a still-active losing stream is measured live up to resolvedAt.
    function lossClaimable(uint256 account, bytes32 vaultId, Side side) external view returns (uint256) {
        VaultData storage data = vaults[vaultId];
        if (data.status != Status.Resolved) return 0;
        Side winning = data.outcome == Outcome.Yes ? Side.Yes : Side.No;
        if (side == winning) return 0;
        return _lossUsdc(_positions[vaultId][side][account], uint256(data.resolvedAt));
    }

    function _lossUsdc(Position storage p, uint256 resolvedAt) internal view returns (uint256 total) {
        total = p.lostUsdc;
        if (p.rate > 0) {
            uint256 end = uint256(p.maxEnd) < resolvedAt ? uint256(p.maxEnd) : resolvedAt;
            if (end > uint256(p.fundStart)) total += p.rate * (end - uint256(p.fundStart));
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                       INTERNAL — advance / settle
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice True once the board has been advanced to the current accrual cap (now, or resolvedAt).
    function _boardCaughtUp(bytes32 vaultId, Side side) internal view returns (bool) {
        uint32 last = _boards[vaultId][side].lastAdvance;
        if (last == 0) return true;
        uint256 target = block.timestamp;
        uint32 resolvedAt = vaults[vaultId].resolvedAt;
        if (resolvedAt != 0 && uint256(resolvedAt) < target) target = resolvedAt;
        return uint256(last) == target;
    }

    /// @notice Catch the board up and require it reached the accrual cap. Position-mutating hooks
    /// (`onFund`/`onStop`/`refreshMaxEnds`) use this so a position is never opened, closed, or
    /// re-pegged against a board the MAX_STEPS cap left behind — that would apply a funder's rate
    /// across a stretch it never streamed (over-credit) or drop it before one it did (strand funds).
    /// A backlog beyond MAX_STEPS reverts; anyone can drain it first via `advance()` (bounded,
    /// brick-free), and no new boundary can be queued while behind, so the backlog only shrinks.
    function _advanceToNow(bytes32 vaultId, Side side) internal {
        _advance(vaultId, side, MAX_STEPS);
        require(_boardCaughtUp(vaultId, side), "Vault: board behind, advance first");
    }

    function _advance(bytes32 vaultId, Side side, uint256 maxSteps) internal {
        Board storage b = _boards[vaultId][side];
        if (b.lastAdvance == 0) {
            b.lastAdvance = uint32(block.timestamp);
            return;
        }
        uint256 t = b.lastAdvance;
        uint256 nowTs = block.timestamp;
        uint32 resolvedAt = vaults[vaultId].resolvedAt;
        if (resolvedAt != 0 && uint256(resolvedAt) < nowTs) nowTs = resolvedAt; // freeze accrual at resolution
        Boundary[] storage arr = _boundaries[vaultId][side];
        uint256 head = _boundaryHead[vaultId][side];
        uint256 len = arr.length;

        uint256 steps = 0;
        while (steps < maxSteps && head < len) {
            uint32 bMaxEnd = arr[head].maxEnd;
            if (uint256(bMaxEnd) > nowTs) break;
            uint256 boundaryAccount = arr[head].account;
            Position storage p = _positions[vaultId][side][boundaryAccount];
            // valid depletion iff the funder is still active with exactly this maxEnd
            if (p.rate > 0 && !p.depleted && p.maxEnd == bMaxEnd) {
                _segment(b, t, bMaxEnd);
                _settle(vaultId, side, boundaryAccount);
                // Bank the full USDC this stream delivered (it ran dry at bMaxEnd ≤ resolvedAt) — the
                // loss basis the funder can later mint LVST against if this side loses.
                if (bMaxEnd > p.fundStart) p.lostUsdc += p.rate * (uint256(bMaxEnd) - uint256(p.fundStart));
                b.sideRate -= p.rate;
                p.rate = 0;
                p.depleted = true;
                t = bMaxEnd;
            }
            head++;
            steps++;
        }
        _boundaryHead[vaultId][side] = head;

        // Finish to `nowTs` only when no due boundary remains unprocessed. A budget-limited stop with
        // due boundaries still queued leaves the board at the last processed boundary (poke again to
        // continue) — so the board never advances past a rate-drop it has not yet applied.
        bool moreDue = head < len && uint256(arr[head].maxEnd) <= nowTs;
        if (!moreDue && t < nowTs) {
            _segment(b, t, nowTs);
            t = nowTs;
        }
        b.lastAdvance = uint32(t);
    }

    function _segment(Board storage b, uint256 t0, uint256 t1) internal {
        if (t1 <= t0 || b.sideRate == 0) return;
        (uint256 newPool, uint256 dG) = BondingBoard.segMath(b.pool, b.sideRate, t1 - t0);
        b.sideShares += b.sideRate * dG; // total side shares minted over this segment (payout denominator)
        b.pool = newPool;
        b.g += dG;
    }

    function _settle(bytes32 vaultId, Side side, uint256 account) internal {
        Board storage b = _boards[vaultId][side];
        Position storage p = _positions[vaultId][side][account];
        if (p.gPaid == b.g) return;
        uint256 d = p.rate * (b.g - p.gPaid);
        p.sharesAccrued += d;
        p.gPaid = b.g;
    }

    function _previewG(bytes32 vaultId, Side side, uint256 atTs) internal view returns (uint256 g) {
        Board storage b = _boards[vaultId][side];
        g = b.g;
        if (b.lastAdvance == 0) return g;
        uint256 pool = b.pool;
        uint256 sideRate = b.sideRate;
        uint256 t = b.lastAdvance;

        Boundary[] storage arr = _boundaries[vaultId][side];
        uint256 idx = _boundaryHead[vaultId][side];
        uint256 len = arr.length;
        while (idx < len) {
            uint32 bMaxEnd = arr[idx].maxEnd;
            if (uint256(bMaxEnd) > atTs) break;
            Position storage p = _positions[vaultId][side][arr[idx].account];
            if (p.rate > 0 && !p.depleted && p.maxEnd == bMaxEnd) {
                if (sideRate != 0 && uint256(bMaxEnd) > t) {
                    (pool, g) = _applySeg(pool, sideRate, g, uint256(bMaxEnd) - t);
                }
                sideRate -= p.rate;
                t = uint256(bMaxEnd);
            }
            idx++;
        }
        if (sideRate != 0 && atTs > t) {
            (pool, g) = _applySeg(pool, sideRate, g, atTs - t);
        }
    }

    function _applySeg(uint256 pool, uint256 sideRate, uint256 g, uint256 dt) internal pure returns (uint256, uint256) {
        (uint256 newPool, uint256 dG) = BondingBoard.segMath(pool, sideRate, dt);
        return (newPool, g + dG);
    }

    function _scheduleBoundary(bytes32 vaultId, Side side, uint32 maxEnd, uint256 account) internal {
        Boundary[] storage arr = _boundaries[vaultId][side];
        arr.push(Boundary({maxEnd: maxEnd, account: account}));
        uint256 i = arr.length - 1;
        uint256 head = _boundaryHead[vaultId][side];
        while (i > head && arr[i - 1].maxEnd > maxEnd) {
            arr[i] = arr[i - 1];
            i--;
        }
        arr[i] = Boundary({maxEnd: maxEnd, account: account});
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          RESOLUTION
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Finalize the pot and pull delivered USDC into the Vault. The pot is the Board truth at
    /// `resolvedAt` — `yesPool + noPool`, i.e. exactly the USDC both sides streamed up to resolution
    /// (invariant I1: pool == delivered) — not whatever happens to be physically collected at this
    /// instant. That makes the pot independent of collect timing and order, so an early or partial
    /// call can never strand the winners' money. The harvest calls are an idempotent liquidity
    /// pull, so `collect` is safe to call repeatedly; pair with a later harvest once cycles
    /// complete, then `withdraw` pays winners and overage.
    function collect(bytes32 vaultId) external {
        VaultData storage data = vaults[vaultId];
        require(data.status == Status.Resolved, "Vault: not resolved");

        // Full catch-up to resolvedAt (uncapped) so the pot is exact. If a side ever amasses more dry
        // boundaries than fit one block's gas, drain it first with the permissionless `advance()`
        // (bounded, brick-free) and this becomes a no-op — funds are never stranded, only deferred.
        _advance(vaultId, Side.Yes, type(uint256).max);
        _advance(vaultId, Side.No, type(uint256).max);

        // Finalize the pot once: the Board truth at resolvedAt, minus the LVST house-pot skim taken off
        // the losing side (the bounty). Boards are frozen at resolvedAt, so this is stable across calls.
        if (!collected[vaultId]) {
            collected[vaultId] = true; // pot finalized; claims / reclaims may proceed
            Side winning = data.outcome == Outcome.Yes ? Side.Yes : Side.No;
            uint256 winPool = _boards[vaultId][winning].pool;
            uint256 losePool = _boards[vaultId][winning == Side.Yes ? Side.No : Side.Yes].pool;
            if (_boards[vaultId][winning].sideShares == 0 && address(treasury) != address(0)) {
                // No winning-side shareholders: the pot has no pro-rata payees and would otherwise
                // strand. Sweep the whole pot to the Treasury house pot (losers still mint LVST against
                // their loss basis). pot stays 0 so no winner withdrawal is possible.
                skimOwed[vaultId] = winPool + losePool;
                pot[vaultId] = 0;
            } else {
                uint256 skim;
                if (address(treasury) != address(0) && losePool > 0) {
                    skim = (losePool * treasury.skimBps()) / 10_000;
                }
                skimOwed[vaultId] = skim;
                pot[vaultId] = winPool + losePool - skim;
            }
        }

        // Idempotent liquidity gather: bank whatever Drips has delivered so far into the Vault.
        vaultDriver.harvest(vaultId, Side.Yes);
        vaultDriver.harvest(vaultId, Side.No);

        // Flush the skim to the LVST house pot once the cash is in. skim ≤ the pot residual, so this
        // never starves winners; idempotent (zeroed once sent), and a cashless early collect just waits.
        uint256 owed = skimOwed[vaultId];
        if (owed > 0 && usdc.balanceOf(address(this)) >= owed) {
            skimOwed[vaultId] = 0;
            usdc.safeTransfer(address(treasury), owed);
            treasury.notifySkim(owed);
            emit Skimmed(vaultId, owed);
        }

        emit Collected(vaultId, pot[vaultId]);
    }

    /// @notice Pay a position's winnings and overage for both sides to `payee`. Revert-free when
    /// nothing is owed; only a funding driver may call (MarketDriver or VaultDriver seed path).
    function withdraw(uint256 account, bytes32 vaultId, address payee)
        external
        onlyFundingDriver
        returns (uint256 total)
    {
        VaultData storage data = vaults[vaultId];
        if (data.status != Status.Resolved || !collected[vaultId]) return 0;

        Side winning = data.outcome == Outcome.Yes ? Side.Yes : Side.No;
        uint32 resolvedAt = data.resolvedAt;

        _advance(vaultId, Side.Yes, type(uint256).max);
        _advance(vaultId, Side.No, type(uint256).max);

        total += _withdrawSide(account, vaultId, Side.Yes, winning, payee, resolvedAt);
        total += _withdrawSide(account, vaultId, Side.No, winning, payee, resolvedAt);

        if (total > 0) emit Withdrawn(vaultId, account, payee, total);
    }

    function _withdrawSide(uint256 account, bytes32 vaultId, Side side, Side winning, address payee, uint32 resolvedAt)
        internal
        returns (uint256 paid)
    {
        paid += _payWinnings(account, vaultId, side, winning, payee);
        paid += _payOverage(account, vaultId, side, payee, resolvedAt);
    }

    function _payWinnings(uint256 account, bytes32 vaultId, Side side, Side winning, address payee)
        internal
        returns (uint256 payout)
    {
        if (side != winning || claimed[vaultId][side][account]) return 0;

        _settle(vaultId, side, account);
        Position storage p = _positions[vaultId][side][account];
        uint256 shares = p.sharesAccrued;
        if (shares == 0) return 0;

        uint256 sideTotal = _boards[vaultId][side].sideShares;
        if (sideTotal == 0) return 0;

        payout = FixedPointMathLib.fullMulDiv(pot[vaultId], shares, sideTotal);
        if (payout == 0) return 0;

        claimed[vaultId][side][account] = true;
        usdc.safeTransfer(payee, payout);
        emit Claimed(vaultId, side, account, shares, payout);
    }

    function _payOverage(uint256 account, bytes32 vaultId, Side side, address payee, uint32 resolvedAt)
        internal
        returns (uint256 amt)
    {
        Position storage p = _positions[vaultId][side][account];
        uint256 entitlement;
        if (p.rate > 0) {
            uint256 end = uint256(p.maxEnd) < block.timestamp ? uint256(p.maxEnd) : block.timestamp;
            if (end > uint256(resolvedAt)) entitlement = p.rate * (end - uint256(resolvedAt));
        } else {
            entitlement = overageOwed[vaultId][side][account];
        }

        uint256 already = overagePaid[vaultId][side][account];
        if (entitlement <= already) return 0;

        amt = entitlement - already;
        overagePaid[vaultId][side][account] = entitlement;
        if (p.rate == 0) overageOwed[vaultId][side][account] = 0;

        usdc.safeTransfer(payee, amt);
        emit OverageReclaimed(vaultId, side, account, amt);
    }
}
