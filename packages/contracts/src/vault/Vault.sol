// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.20;

import {Side} from "./Side.sol";
import {BondingBoard} from "./BondingBoard.sol";
import {IDrips} from "../streaming/IDrips.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";

/// @dev LVST house-pot sink: the Vault skims a slice of the bounty here at resolution.
interface ILvstSkim {
    function skimBps() external view returns (uint256);
    function notifySkim(uint256 amount) external;
}

/// @title Vault — binary YES/NO pool state under one market, with the streamed-funding Board.
///
/// @notice Owns per-side pricing (the Board), per-funder positions, and the resolution skeleton.
/// Funding flows in as USDC streams (via the vault-aware AddressDriver), priced fairly on the
/// bonding curve through one cumulative index `g` per (vault, side). The Vault is also a Drips
/// driver for its own receiver accounts, so only it can collect a side's streamed USDC at
/// resolution.
///
/// @dev Board math is `BondingBoard`. Design: docs/streamed-funding-explained.md. Resolution
/// (collect / claimFor payout) is the next slice — see the marked section at the bottom.
contract Vault {
    using SafeERC20 for IERC20;

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
        address funder;
    }

    address public factory;
    address public fundingDriver; // the vault-aware AddressDriver
    address public resolver; // the steward path authorized to set outcomes
    IDrips public drips;
    IERC20 public usdc;
    uint32 public driverId; // FD_vault (Drips driver id for receiver accounts)

    uint256 private _nonce;
    uint64 public nextPoolId = 1;

    mapping(bytes32 => VaultData) public vaults;
    mapping(bytes32 => mapping(Side => Board)) internal _boards;
    mapping(bytes32 => mapping(Side => mapping(address => Position))) internal _positions;
    mapping(bytes32 => mapping(Side => Boundary[])) internal _boundaries;
    mapping(bytes32 => mapping(Side => uint256)) internal _boundaryHead;
    mapping(bytes32 => mapping(Side => uint64)) public poolIdOf;

    mapping(bytes32 => uint256) public pot; // USDC the winning side splits (Board truth at resolvedAt)
    mapping(bytes32 => bool) public collected;
    mapping(bytes32 => mapping(Side => mapping(address => bool))) public claimed;
    mapping(bytes32 => mapping(Side => mapping(address => uint256))) public overageOwed; // streamed past resolvedAt
    mapping(address => bytes32[]) private _userVaults; // every vault a user has funded, first-funded order
    mapping(address => mapping(bytes32 => bool)) private _userInVault; // dedupe guard for _userVaults

    ILvstSkim public lvstToken; // LVST house pot; receives the winner-skim at resolution (0 = skim off)
    mapping(bytes32 => uint256) public skimOwed; // skim computed at first collect, flushed once cash is in

    event VaultCreated(bytes32 indexed vaultId, bytes32 indexed marketId, address indexed creator, string question);
    event VaultResolved(bytes32 indexed vaultId, Outcome outcome);
    event StreamingSet(address indexed drips, address indexed usdc, uint32 driverId);
    event FundingDriverSet(address indexed fundingDriver);
    event ResolverSet(address indexed resolver);
    event LvstTokenSet(address indexed lvstToken);
    event Skimmed(bytes32 indexed vaultId, uint256 amount);
    event Funded(bytes32 indexed vaultId, Side indexed side, address indexed funder, uint256 rate, uint32 maxEnd);
    event Stopped(bytes32 indexed vaultId, Side indexed side, address indexed funder, uint256 sharesAccrued);
    event Collected(bytes32 indexed vaultId, uint256 pot);
    event Claimed(bytes32 indexed vaultId, Side indexed side, address indexed funder, uint256 shares, uint256 payout);
    event OverageRecorded(bytes32 indexed vaultId, Side indexed side, address indexed funder, uint256 amount);
    event OverageReclaimed(bytes32 indexed vaultId, Side indexed side, address indexed funder, uint256 amount);

    modifier onlyFactory() {
        require(msg.sender == factory, "Vault: not factory");
        _;
    }

    modifier onlyFundingDriver() {
        require(msg.sender == fundingDriver, "Vault: not funding driver");
        _;
    }

    modifier onlyResolver() {
        require(msg.sender == resolver, "Vault: not resolver");
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              WIRING
    // ═══════════════════════════════════════════════════════════════════════

    function setFactory(address factory_) external {
        require(factory == address(0), "Vault: factory already set");
        require(factory_ != address(0), "Vault: zero factory");
        factory = factory_;
    }

    /// @notice Wire the streaming rail once and register as a Drips driver for receiver accounts.
    function setStreaming(IDrips drips_, IERC20 usdc_) external {
        require(address(drips) == address(0), "Vault: streaming already set");
        require(address(drips_) != address(0) && address(usdc_) != address(0), "Vault: zero streaming");
        drips = drips_;
        usdc = usdc_;
        driverId = drips_.registerDriver(address(this));
        emit StreamingSet(address(drips_), address(usdc_), driverId);
    }

    function setFundingDriver(address fundingDriver_) external {
        require(fundingDriver == address(0), "Vault: funding driver already set");
        require(fundingDriver_ != address(0), "Vault: zero funding driver");
        fundingDriver = fundingDriver_;
        emit FundingDriverSet(fundingDriver_);
    }

    /// @notice Wire the resolver once — the steward path (`StewardRegistry`) allowed to set outcomes.
    function setResolver(address resolver_) external {
        require(resolver == address(0), "Vault: resolver already set");
        require(resolver_ != address(0), "Vault: zero resolver");
        resolver = resolver_;
        emit ResolverSet(resolver_);
    }

    /// @notice Wire the LVST house pot once. While unset, the winner-skim is off (skim = 0).
    function setLvstToken(address lvstToken_) external {
        require(address(lvstToken) == address(0), "Vault: lvst token already set");
        require(lvstToken_ != address(0), "Vault: zero lvst token");
        lvstToken = ILvstSkim(lvstToken_);
        emit LvstTokenSet(lvstToken_);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          VAULT LIFECYCLE
    // ═══════════════════════════════════════════════════════════════════════

    function createVault(bytes32 marketId, string calldata question, address creator)
        external
        onlyFactory
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

        emit VaultCreated(vaultId, marketId, creator, question);
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

    /// @notice The Drips receiver account for a (vault, side); assigns a poolId on first use.
    function receiverAccount(bytes32 vaultId, Side side) external onlyFundingDriver returns (uint256) {
        require(vaults[vaultId].exists, "Vault: unknown vault");
        uint64 pid = poolIdOf[vaultId][side];
        if (pid == 0) {
            pid = nextPoolId++;
            poolIdOf[vaultId][side] = pid;
        }
        return _receiverAccount(pid);
    }

    /// @notice Open a funder's position after the driver has set the real Drips stream.
    function onFund(address funder, bytes32 vaultId, Side side, uint256 rate, uint32 maxEnd)
        external
        onlyFundingDriver
    {
        require(vaults[vaultId].status == Status.Open, "Vault: not open");
        require(rate > 0, "Vault: zero rate");

        if (!_userInVault[funder][vaultId]) {
            _userInVault[funder][vaultId] = true;
            _userVaults[funder].push(vaultId);
        }

        _advance(vaultId, side, MAX_STEPS);
        _settle(vaultId, side, funder);

        Position storage p = _positions[vaultId][side][funder];
        require(p.rate == 0 && !p.depleted, "Vault: already funding");

        Board storage b = _boards[vaultId][side];
        p.rate = rate;
        p.gPaid = b.g;
        p.maxEnd = maxEnd;
        p.fundStart = uint32(block.timestamp);
        b.sideRate += rate;
        _scheduleBoundary(vaultId, side, maxEnd, funder);

        emit Funded(vaultId, side, funder, rate, maxEnd);
    }

    /// @notice Close a funder's position; banks accrued shares and drops the rate.
    function onStop(address funder, bytes32 vaultId, Side side) external onlyFundingDriver {
        _advance(vaultId, side, MAX_STEPS);
        _settle(vaultId, side, funder);

        Position storage p = _positions[vaultId][side][funder];
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
                    overageOwed[vaultId][side][funder] += over;
                    emit OverageRecorded(vaultId, side, funder, over);
                }
            }
            _boards[vaultId][side].sideRate -= p.rate;
            p.rate = 0; // its scheduled boundary becomes stale (rate 0 → skipped on advance)
        }
        emit Stopped(vaultId, side, funder, p.sharesAccrued);
    }

    /// @notice Permissionless poke: catch the Board up, bounded by `maxSteps`.
    function advance(bytes32 vaultId, Side side, uint256 maxSteps) external {
        _advance(vaultId, side, maxSteps == 0 ? MAX_STEPS : maxSteps);
    }

    /// @notice Catch up then bank a funder's accrued shares at the current `g`.
    function settle(bytes32 vaultId, Side side, address funder) external {
        _advance(vaultId, side, MAX_STEPS);
        _settle(vaultId, side, funder);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              READS
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Shares `funder` would be credited if settled now (same math as settle; view-parity).
    function pendingShares(bytes32 vaultId, Side side, address funder) external view returns (uint256) {
        Position storage p = _positions[vaultId][side][funder];
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

    function getPosition(bytes32 vaultId, Side side, address funder)
        external
        view
        returns (uint256 rate, uint256 gPaid, uint256 sharesAccrued, uint32 maxEnd, bool depleted)
    {
        Position storage p = _positions[vaultId][side][funder];
        return (p.rate, p.gPaid, p.sharesAccrued, p.maxEnd, p.depleted);
    }

    function caughtUp(bytes32 vaultId, Side side) external view returns (bool) {
        uint32 last = _boards[vaultId][side].lastAdvance;
        uint256 target = block.timestamp;
        uint32 resolvedAt = vaults[vaultId].resolvedAt;
        if (resolvedAt != 0 && uint256(resolvedAt) < target) target = resolvedAt;
        return last == 0 || uint256(last) == target;
    }

    function receiverAccountView(bytes32 vaultId, Side side) external view returns (uint256) {
        return _receiverAccount(poolIdOf[vaultId][side]);
    }

    /// @notice Every vault `user` has funded (either side), in first-funded order. Lets a client
    /// aggregate a user's positions and loss-claims without scanning every market.
    function getUserVaultIds(address user) external view returns (bytes32[] memory) {
        return _userVaults[user];
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
    function claimable(address funder, bytes32 vaultId, Side side) external view returns (uint256) {
        VaultData storage data = vaults[vaultId];
        if (data.status != Status.Resolved || !collected[vaultId]) return 0;
        Side winning = data.outcome == Outcome.Yes ? Side.Yes : Side.No;
        if (side != winning || claimed[vaultId][side][funder]) return 0;

        Board storage b = _boards[vaultId][side];
        if (b.sideShares == 0) return 0;
        Position storage p = _positions[vaultId][side][funder];
        uint256 shares = p.sharesAccrued + p.rate * (b.g - p.gPaid);
        if (shares == 0) return 0;
        return FixedPointMathLib.fullMulDiv(pot[vaultId], shares, b.sideShares);
    }

    /// @notice USDC `funder` lost on the losing side — the basis they mint LVST against. 0 before
    /// resolution, for the winning side, or for a non-funder. Survives stop/deplete (banked in
    /// `lostUsdc`); a still-active losing stream is measured live up to resolvedAt.
    function lossClaimable(address funder, bytes32 vaultId, Side side) external view returns (uint256) {
        VaultData storage data = vaults[vaultId];
        if (data.status != Status.Resolved) return 0;
        Side winning = data.outcome == Outcome.Yes ? Side.Yes : Side.No;
        if (side == winning) return 0;
        return _lossUsdc(_positions[vaultId][side][funder], uint256(data.resolvedAt));
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
            address funder = arr[head].funder;
            Position storage p = _positions[vaultId][side][funder];
            // valid depletion iff the funder is still active with exactly this maxEnd
            if (p.rate > 0 && !p.depleted && p.maxEnd == bMaxEnd) {
                _segment(b, t, bMaxEnd);
                _settle(vaultId, side, funder);
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

        if (steps < maxSteps && t < nowTs) {
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

    function _settle(bytes32 vaultId, Side side, address funder) internal {
        Board storage b = _boards[vaultId][side];
        Position storage p = _positions[vaultId][side][funder];
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
            Position storage p = _positions[vaultId][side][arr[idx].funder];
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

    function _scheduleBoundary(bytes32 vaultId, Side side, uint32 maxEnd, address funder) internal {
        Boundary[] storage arr = _boundaries[vaultId][side];
        arr.push(Boundary({maxEnd: maxEnd, funder: funder}));
        uint256 i = arr.length - 1;
        uint256 head = _boundaryHead[vaultId][side];
        while (i > head && arr[i - 1].maxEnd > maxEnd) {
            arr[i] = arr[i - 1];
            i--;
        }
        arr[i] = Boundary({maxEnd: maxEnd, funder: funder});
    }

    function _receiverAccount(uint64 poolId) internal view returns (uint256) {
        return (uint256(driverId) << 224) | uint256(poolId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                          RESOLUTION
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Finalize the pot and pull delivered USDC into the Vault. The pot is the Board truth at
    /// `resolvedAt` — `yesPool + noPool`, i.e. exactly the USDC both sides streamed up to resolution
    /// (invariant I1: pool == delivered) — not whatever happens to be physically collected at this
    /// instant. That makes the pot independent of collect timing and order, so an early or partial
    /// call can never strand the winners' money. The `_collectSide` calls are an idempotent liquidity
    /// pull, so `collect` is safe to call repeatedly; pair it with `AddressDriver.settle`, which banks
    /// each active funder's in-flight Drips cycle, before winners claim.
    function collect(bytes32 vaultId) external {
        VaultData storage data = vaults[vaultId];
        require(data.status == Status.Resolved, "Vault: not resolved");

        _advance(vaultId, Side.Yes, type(uint256).max);
        _advance(vaultId, Side.No, type(uint256).max);

        // Finalize the pot once: the Board truth at resolvedAt, minus the LVST house-pot skim taken off
        // the losing side (the bounty). Boards are frozen at resolvedAt, so this is stable across calls.
        if (!collected[vaultId]) {
            collected[vaultId] = true; // pot finalized; claims / reclaims may proceed
            Side winning = data.outcome == Outcome.Yes ? Side.Yes : Side.No;
            uint256 winPool = _boards[vaultId][winning].pool;
            uint256 losePool = _boards[vaultId][winning == Side.Yes ? Side.No : Side.Yes].pool;
            uint256 skim;
            if (address(lvstToken) != address(0) && losePool > 0) {
                skim = (losePool * lvstToken.skimBps()) / 10_000;
            }
            skimOwed[vaultId] = skim;
            pot[vaultId] = winPool + losePool - skim;
        }

        // Idempotent liquidity gather: bank whatever Drips has delivered so far into the Vault.
        _collectSide(vaultId, Side.Yes);
        _collectSide(vaultId, Side.No);

        // Flush the skim to the LVST house pot once the cash is in. skim ≤ the pot residual, so this
        // never starves winners; idempotent (zeroed once sent), and a cashless early collect just waits.
        uint256 owed = skimOwed[vaultId];
        if (owed > 0 && usdc.balanceOf(address(this)) >= owed) {
            skimOwed[vaultId] = 0;
            usdc.safeTransfer(address(lvstToken), owed);
            lvstToken.notifySkim(owed);
            emit Skimmed(vaultId, owed);
        }

        emit Collected(vaultId, pot[vaultId]);
    }

    function _collectSide(bytes32 vaultId, Side side) internal returns (uint256) {
        uint64 pid = poolIdOf[vaultId][side];
        if (pid == 0) return 0;
        uint256 receiver = _receiverAccount(pid);
        drips.receiveStreams(receiver, usdc, type(uint32).max);
        uint128 amt = drips.collect(receiver, usdc);
        if (amt > 0) drips.withdraw(usdc, address(this), amt);
        return uint256(amt);
    }

    /// @notice Pay `funder` their winnings: `pot · their shares / winning-side shares`. The losing
    /// side and double claims revert. Permissionless — the payout always goes to `funder`.
    function claimFor(address funder, bytes32 vaultId, Side side) external returns (uint256 payout) {
        VaultData storage data = vaults[vaultId];
        require(data.status == Status.Resolved, "Vault: not resolved");
        require(collected[vaultId], "Vault: not collected");
        Side winning = data.outcome == Outcome.Yes ? Side.Yes : Side.No;
        require(side == winning, "Vault: not winning side");
        require(!claimed[vaultId][side][funder], "Vault: already claimed");

        _advance(vaultId, side, type(uint256).max);
        _settle(vaultId, side, funder);
        claimed[vaultId][side][funder] = true;

        uint256 shares = _positions[vaultId][side][funder].sharesAccrued;
        require(shares > 0, "Vault: no shares");
        uint256 sideTotal = _boards[vaultId][side].sideShares;
        payout = FixedPointMathLib.fullMulDiv(pot[vaultId], shares, sideTotal);
        if (payout > 0) usdc.safeTransfer(funder, payout);
        emit Claimed(vaultId, side, funder, shares, payout);
    }

    /// @notice Refund USDC `funder` streamed AFTER `resolvedAt` — money past the freeze that was never
    /// part of any bet (recorded in `onStop`). Permissionless; always pays the recorded `funder`.
    /// @dev Requires the pot to be finalized (`collect`). The cash must already be in the Vault; if the
    /// funder's post-resolution cycle hasn't been collected yet the transfer reverts — a recoverable
    /// retry, never a loss. The funder's own `AddressDriver.stop` squeezes that cycle so it is present.
    function reclaimOverage(address funder, bytes32 vaultId, Side side) external returns (uint256 amt) {
        require(collected[vaultId], "Vault: not collected");
        amt = overageOwed[vaultId][side][funder];
        require(amt > 0, "Vault: no overage");
        overageOwed[vaultId][side][funder] = 0;
        usdc.safeTransfer(funder, amt);
        emit OverageReclaimed(vaultId, side, funder, amt);
    }
}
