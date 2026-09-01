// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/token/ERC20/utils/SafeERC20.sol";
import {Side} from "../vault/Side.sol";

/// @dev Per-funder loss basis lives on the Vault.
interface IVaultLoss {
    function lossClaimable(address funder, bytes32 vaultId, Side side) external view returns (uint256);
}

/// @title LvstToken (LVST) — the LiveStreak house token.
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
contract LvstToken is ERC20, Ownable {
    using SafeERC20 for IERC20;

    uint256 internal constant ACC_SCALE = 1e18; // dividend-accumulator fixed point
    uint256 internal constant USDC_ONE = 1e6; // one whole USDC (6-dec)

    IERC20 public immutable usdc; // dividend asset (the skim is paid in USDC)
    IVaultLoss public vault; // source of each funder's loss basis

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

    mapping(address => mapping(bytes32 => mapping(Side => bool))) public lossClaimed;

    event VaultSet(address indexed vault);
    event Skimmed(uint256 amount, uint256 totalSkimmed);
    event LossLvstClaimed(
        address indexed user, bytes32 indexed vaultId, Side indexed side, uint256 lostUsdc, uint256 minted
    );
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event DividendsClaimed(address indexed user, uint256 amount);
    event MintParamsSet(uint256 start, uint256 floor, uint256 knee);
    event SkimBpsSet(uint256 bps);

    constructor(address initialOwner, IERC20 usdc_) ERC20("LiveStreak", "LVST") Ownable(initialOwner) {
        require(address(usdc_) != address(0), "LvstToken: zero usdc");
        usdc = usdc_;
    }

    // ── governance ──────────────────────────────────────────────────────────

    function setVault(address vault_) external onlyOwner {
        require(vault_ != address(0), "LvstToken: zero vault");
        vault = IVaultLoss(vault_);
        emit VaultSet(vault_);
    }

    function setSkimBps(uint256 bps) external onlyOwner {
        require(bps <= 2_000, "LvstToken: skim too high"); // ≤ 20%
        skimBps = bps;
        emit SkimBpsSet(bps);
    }

    function setMintParams(uint256 start, uint256 floor, uint256 knee) external onlyOwner {
        require(start >= floor && knee > 0, "LvstToken: bad mint params");
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
        require(msg.sender == address(vault), "LvstToken: not vault");
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

    /// @notice Mint LVST for the caller's loss on a resolved vault's losing side.
    function claimLossLvst(bytes32 vaultId, Side side) external returns (uint256 minted) {
        minted = _mintLoss(msg.sender, vaultId, side);
    }

    /// @notice Mint loss LVST and stake it in the same call.
    function claimAndStakeLossLvst(bytes32 vaultId, Side side) external returns (uint256 minted) {
        minted = _mintLoss(msg.sender, vaultId, side);
        _stake(msg.sender, minted);
    }

    function _mintLoss(address user, bytes32 vaultId, Side side) internal returns (uint256 minted) {
        require(!lossClaimed[user][vaultId][side], "LvstToken: already claimed");
        uint256 lostUsdc = vault.lossClaimable(user, vaultId, side);
        require(lostUsdc > 0, "LvstToken: nothing lost");
        lossClaimed[user][vaultId][side] = true;
        minted = (lostUsdc * mintRate()) / USDC_ONE;
        _mint(user, minted);
        emit LossLvstClaimed(user, vaultId, side, lostUsdc, minted);
    }

    /// @notice LVST the caller would mint for a loss right now (0 once claimed).
    function lossLvstClaimable(address user, bytes32 vaultId, Side side) external view returns (uint256) {
        if (lossClaimed[user][vaultId][side]) return 0;
        return (vault.lossClaimable(user, vaultId, side) * mintRate()) / USDC_ONE;
    }

    // ── staking + dividends ───────────────────────────────────────────────────

    function stakeLvst(uint256 amount) external {
        _stake(msg.sender, amount);
    }

    function unstakeLvst(uint256 amount) external {
        require(amount > 0 && stakeOf[msg.sender] >= amount, "LvstToken: invalid unstake");
        _settleDividends(msg.sender);
        stakeOf[msg.sender] -= amount;
        totalStaked -= amount;
        rewardDebt[msg.sender] = (stakeOf[msg.sender] * accUsdcPerStake) / ACC_SCALE;
        _transfer(address(this), msg.sender, amount);
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
        require(amount > 0, "LvstToken: zero stake");
        _settleDividends(user);
        _transfer(user, address(this), amount);
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
        return balanceOf(user);
    }

    function lvstStaked(address user) external view returns (uint256) {
        return stakeOf[user];
    }

    function lvstPendingDividends(address user) external view returns (uint256) {
        return pendingDividends(user);
    }
}
