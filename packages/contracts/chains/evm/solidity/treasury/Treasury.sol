// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";
import {Side} from "../vault/Side.sol";
import {Protocol} from "../Protocol.sol";
import {LvstToken} from "./LvstToken.sol";

/// @dev Per-funder loss basis lives on the Vault.
interface IVaultLoss {
    function lossClaimable(uint256 account, bytes32 vaultId, Side side) external view returns (uint256);
}

/// @dev Vault skim sink surface.
interface ITreasurySkim {
    function skimBps() external view returns (uint256);
    function notifySkim(uint256 amount) external;
}

/// @title Treasury — LVST house-pot economics (skim, mint curve, loss-mint, staking, dividends).
///
/// @notice Three coupled mechanisms:
///  1. **Winner-skim → house pot.** At resolution the Vault skims a slice of the bounty (the losers'
///     money) and sends it here as USDC via `notifySkim`. That USDC is the stakers' dividend.
///  2. **Loss → LVST.** Losers mint LVST against their lost USDC: `LVST = lostUSD · mintRate()`, where
///     `mintRate` is a curve on the **cumulative** house pot — fat when the pot is small, tapering to a
///     flat floor. Cumulative (not live) is deliberate: it can't be reset by draining dividends, which
///     would otherwise let a staker spike the rate and farm cheap LVST.
///  3. **Stake LVST → earn the skim.** Staked LVST earns the USDC skim pro-rata (standard accumulator).
///
/// @dev A two-wallet wash (bet both sides, lose one on purpose) only ever pays the skim — and feeds the
/// very pot that backs LVST while pushing its own rate down — so it converges to ~break-even, not a
/// printer. See docs + the `lvst-token-economics` design note. Curve params are governance-tunable.
contract Treasury is Ownable, ITreasurySkim {
    using SafeERC20 for IERC20;

    uint256 internal constant ACC_SCALE = 1e18; // dividend-accumulator fixed point
    uint256 internal constant USDC_ONE = 1e6; // one whole USDC (6-dec)

    Protocol public immutable protocol;
    IERC20 public immutable usdc; // dividend asset (the skim is paid in USDC)

    uint256 public skimBps = 200; // 2% of the bounty, read by the Vault at resolution

    // mint curve — LVST (18-dec) per whole USDC = floor + (start-floor)·knee/(knee+pool)
    uint256 public mintStart = 100e18; // rate when the house pot is empty
    uint256 public mintFloor = 1e18; // flat-tail rate once the pot is huge
    uint256 public mintKnee = 10_000e6; // pot size (USDC units) at the half-way knee
    uint256 public totalSkimmed; // cumulative USDC skimmed (monotonic) — the curve input

    // staking + USDC dividends
    uint256 public totalStaked;
    uint256 public accUsdcPerStake; // ACC_SCALE-scaled cumulative USDC per staked LVST
    uint256 public undistributed; // skim received while nobody staked; folded in on the next notify
    mapping(address => uint256) public stakeOf;
    mapping(address => uint256) public rewardDebt;
    mapping(address => uint256) public accruedDividends;

    mapping(uint256 => mapping(bytes32 => mapping(Side => bool))) public lossClaimed;

    event Skimmed(uint256 amount, uint256 totalSkimmed);
    event LossLvstClaimed(
        address indexed user, bytes32 indexed vaultId, Side indexed side, uint256 lostUsdc, uint256 minted
    );
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event DividendsClaimed(address indexed user, uint256 amount);
    event MintParamsSet(uint256 start, uint256 floor, uint256 knee);
    event SkimBpsSet(uint256 bps);

    constructor(address initialOwner, IERC20 usdc_, Protocol protocol_) Ownable(initialOwner) {
        require(address(usdc_) != address(0), "Treasury: zero usdc");
        require(address(protocol_) != address(0), "Treasury: zero protocol");
        usdc = usdc_;
        protocol = protocol_;
    }

    function vault() public view returns (IVaultLoss) {
        address v = protocol.vault();
        require(v != address(0), "Treasury: vault unset");
        return IVaultLoss(v);
    }

    function lvstToken() public view returns (LvstToken) {
        address t = protocol.lvstToken();
        require(t != address(0), "Treasury: lvst unset");
        return LvstToken(t);
    }

    // ── governance ──────────────────────────────────────────────────────────

    function setSkimBps(uint256 bps) external onlyOwner {
        require(bps <= 2_000, "Treasury: skim too high"); // ≤ 20%
        skimBps = bps;
        emit SkimBpsSet(bps);
    }

    function setMintParams(uint256 start, uint256 floor, uint256 knee) external onlyOwner {
        require(start >= floor && knee > 0, "Treasury: bad mint params");
        mintStart = start;
        mintFloor = floor;
        mintKnee = knee;
        emit MintParamsSet(start, floor, knee);
    }

    // ── mint curve ──────────────────────────────────────────────────────────

    /// @notice LVST minted per whole USDC of loss at the current cumulative house-pot size.
    function mintRate() public view returns (uint256) {
        return mintFloor + ((mintStart - mintFloor) * mintKnee) / (mintKnee + totalSkimmed);
    }

    // ── winner-skim intake (Vault only) ───────────────────────────────────────

    /// @notice The Vault has transferred `amount` USDC here; book it. Grows the monotonic curve gauge
    /// and streams the USDC to current stakers (held until someone stakes if nobody is yet).
    function notifySkim(uint256 amount) external {
        require(msg.sender == protocol.vault(), "Treasury: not vault");
        totalSkimmed += amount;
        uint256 dist = amount + undistributed;
        if (totalStaked > 0) {
            accUsdcPerStake += (dist * ACC_SCALE) / totalStaked;
            undistributed = 0;
        } else {
            undistributed = dist;
        }
        emit Skimmed(amount, totalSkimmed);
    }

    // ── loss → LVST ───────────────────────────────────────────────────────────

    /// @notice Mint LVST for an NFT account's loss; callable only from MarketDriver.
    function mintLossLvst(uint256 account, address to, bytes32 vaultId, Side side) external returns (uint256 minted) {
        require(msg.sender == protocol.marketDriver(), "Treasury: not market driver");
        minted = _mintLoss(account, to, vaultId, side);
    }

    function _mintLoss(uint256 account, address to, bytes32 vaultId, Side side) internal returns (uint256 minted) {
        require(!lossClaimed[account][vaultId][side], "Treasury: already claimed");
        uint256 lostUsdc = vault().lossClaimable(account, vaultId, side);
        require(lostUsdc > 0, "Treasury: nothing lost");
        lossClaimed[account][vaultId][side] = true;
        minted = (lostUsdc * mintRate()) / USDC_ONE;
        lvstToken().mint(to, minted);
        emit LossLvstClaimed(to, vaultId, side, lostUsdc, minted);
    }

    /// @notice LVST an account would mint for a loss right now (0 once claimed).
    function lossLvstClaimable(uint256 account, bytes32 vaultId, Side side) external view returns (uint256) {
        if (lossClaimed[account][vaultId][side]) return 0;
        return (vault().lossClaimable(account, vaultId, side) * mintRate()) / USDC_ONE;
    }

    // ── staking + dividends ───────────────────────────────────────────────────

    function stakeLvst(uint256 amount) external {
        _stake(msg.sender, amount);
    }

    function unstakeLvst(uint256 amount) external {
        require(amount > 0 && stakeOf[msg.sender] >= amount, "Treasury: invalid unstake");
        _settleDividends(msg.sender);
        stakeOf[msg.sender] -= amount;
        totalStaked -= amount;
        rewardDebt[msg.sender] = (stakeOf[msg.sender] * accUsdcPerStake) / ACC_SCALE;
        IERC20(address(lvstToken())).safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    function claimDividends() external returns (uint256 amount) {
        _settleDividends(msg.sender);
        amount = accruedDividends[msg.sender];
        if (amount > 0) {
            accruedDividends[msg.sender] = 0;
            usdc.safeTransfer(msg.sender, amount);
            emit DividendsClaimed(msg.sender, amount);
        }
    }

    function pendingDividends(address user) public view returns (uint256) {
        return accruedDividends[user] + (stakeOf[user] * accUsdcPerStake) / ACC_SCALE - rewardDebt[user];
    }

    function _stake(address user, uint256 amount) internal {
        require(amount > 0, "Treasury: zero stake");
        _settleDividends(user);
        lvstToken().pullFrom(user, amount);
        stakeOf[user] += amount;
        totalStaked += amount;
        rewardDebt[user] = (stakeOf[user] * accUsdcPerStake) / ACC_SCALE;
        emit Staked(user, amount);
    }

    function _settleDividends(address user) internal {
        uint256 acc = (stakeOf[user] * accUsdcPerStake) / ACC_SCALE;
        accruedDividends[user] += acc - rewardDebt[user];
        rewardDebt[user] = acc;
    }

    // ── consumer read aliases ─────────────────────────────────────────────────

    function lvstBalance(address user) external view returns (uint256) {
        return lvstToken().balanceOf(user);
    }

    function lvstStaked(address user) external view returns (uint256) {
        return stakeOf[user];
    }

    function lvstPendingDividends(address user) external view returns (uint256) {
        return pendingDividends(user);
    }
}
