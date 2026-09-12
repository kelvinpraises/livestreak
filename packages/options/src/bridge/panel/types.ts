// --- exports ---

import type {
  OptionsMarketStatus,
  OptionsStreamStatus,
  OptionsVaultOutcome,
  OptionsVaultSide,
  OptionsVaultStatus,
  OptionsVaultType
} from "../../model/index.js";

/** Canonical position-lane state, money-driven. `streaming` = a rate is flowing. `paused` = no active
 *  stream but the NFT's shared balance is still there to resume from (stopped, paused, or a switched-away
 *  leg while the other side streams). `depleted` = no stream and no money left (ran dry or swept to
 *  wallet). The board owns these names so no consumer re-derives them. */
export type OptionsLaneStatus = "streaming" | "paused" | "depleted";

/** Canonical NFT-account state. `idle` = funds parked, nothing streaming; `depleted` = a stream ran the
 *  balance dry; `empty` = no balance and no lanes. Distinguishes "parked" from "drained" at the source. */
export type OptionsAccountStatus = "streaming" | "idle" | "depleted" | "empty";

export interface OptionsLanePanel {
  readonly vaultId: string;
  readonly side: OptionsVaultSide;
  readonly status: OptionsLaneStatus;
  readonly stream: {
    /** Effective stream rate, USDC/min. 0 unless `status === "streaming"`. */
    readonly ratePerMinUSDC: number;
    /** Effective stream rate, USDC base units/sec (precision-preserving). "0" unless streaming. */
    readonly ratePerSecRaw: string;
    /** When this lane's runway ends (ms since epoch). Present only while streaming. */
    readonly endsAtMs?: number;
  };
  readonly shares: {
    readonly accrued: number;
    readonly accruedRaw: string;
    /** This position's share of its side's total shares, as a percent (0–100) — the payout-relevant
     *  ownership fraction. Absent when the side has no shares yet (nothing to take a fraction of). */
    readonly percentOfSide?: number;
  };
  /** Settlement view — present only once the vault has resolved (win/loss known). */
  readonly settlement?: {
    readonly won: boolean;
    readonly claimableUSDC: number;
    readonly lossClaimableLVST: number;
    readonly canClaimWin: boolean;
    readonly canClaimLoss: boolean;
  };
}

export interface OptionsNftPanel {
  readonly tokenId: string;
  readonly marketId: string;
  readonly owner: string;
  readonly laneCount: number;
  readonly lanes: readonly OptionsLanePanel[];
  readonly transfer: {
    readonly approved?: string;
    readonly isOperator?: boolean;
  };
  /** Shared Drips budget + canonical account status. EVM-only fields are absent on Sui. */
  readonly account: {
    readonly status: OptionsAccountStatus;
    /** LIVE shared balance — stored minus what's streamed since the last write. Always the real number. */
    readonly balanceUSDC?: number;
    readonly balanceRaw?: string;
    /** When the shared balance runs dry (ms). Present only while `status === "streaming"`. */
    readonly endsAtMs?: number;
    /** Total drain rate (USDC/sec) across active lanes. Lets the UI tick `balanceUSDC` down between polls
     *  without re-deriving anything. Present only while `status === "streaming"`. */
    readonly drainRatePerSecUSDC?: number;
  };
  /** Per-NFT realized P&L (no net figure — streaming records no cost basis on-chain). */
  readonly pnl: {
    readonly returnedUSDC: number; // Σ claimable on won lanes
    readonly lostLVST: number; // Σ lossClaimable on lost lanes
    readonly remainingUSDC: number; // shared balance still at stake
  };
}

export interface OptionsVaultPanel {
  readonly vaultId: string;
  readonly marketId: string;
  readonly question: string;
  readonly type: OptionsVaultType;
  readonly creator: string;
  readonly status: OptionsVaultStatus;
  readonly outcome: OptionsVaultOutcome;
  readonly pools: {
    readonly yesUSDC: number;
    readonly noUSDC: number;
    readonly totalUSDC: number;
    /** Settled on-chain pool (getVaultPools) — unchanged until advance. */
    readonly settledPoolUSDC: number;
    /** Board-replayed pool at read time (pool + sideRate × Δt). */
    readonly livePoolUSDC: number;
    /** Live per-side pools. Settled per-side pools sit at 0 between advances (always on a frozen dev
     *  chain), collapsing odds to 50/50; the UI reads these. liveYesUSDC + liveNoUSDC === livePoolUSDC. */
    readonly liveYesUSDC: number;
    readonly liveNoUSDC: number;
    /** livePoolUSDC growth in USDC/sec (segMath slope: yes+no side rate, net of ended lanes; 0 once
     *  frozen). Lets the UI tick the pool forward between polls. */
    readonly poolRatePerSecUSDC: number;
    readonly sharePriceYes: number;
    readonly sharePriceNo: number;
  };
  readonly shareTotals: {
    readonly yes: number;
    readonly no: number;
  };
  readonly odds: {
    readonly yesMultiplier: number;
    readonly noMultiplier: number;
    readonly yesProbabilityBps: number;
    readonly noProbabilityBps: number;
  };
  readonly timing: {
    readonly createdAtMs: number;
    readonly expiresAtMs: number;
    readonly lockedAtMs?: number;
    readonly resolvedAtMs?: number;
  };
  readonly steward: {
    readonly hot: boolean;
    readonly hotUntilMs?: number;
    readonly hotReason?: string;
    readonly severity?: number;
    readonly exitBurnBps?: number;
    readonly disputeId?: string;
  };
}

export interface OptionsMarketPanel {
  readonly marketId: string;
  readonly title: string;
  readonly creator: string;
  readonly streamId?: string;
  readonly category?: string;
  readonly status: OptionsMarketStatus;
  readonly vaultIds: readonly string[];
  readonly totals: {
    readonly pooledUSDC: number;
    readonly totalPooledUSDC: number;
    /** Sum of vault livePoolUSDC (board-replayed). */
    readonly livePooledUSDC: number;
    /** Sum of vault poolRatePerSecUSDC — the market pool's current growth in USDC/sec. */
    readonly livePooledRatePerSecUSDC: number;
    readonly activeVaults: number;
    readonly resolvedVaults: number;
  };
  readonly timing?: {
    readonly createdAtMs?: number;
    readonly closesAtMs?: number;
    readonly resolvedAtMs?: number;
  };
  readonly vaults: readonly OptionsVaultPanel[];
  /** Raw on-chain stream pointer. Absent when no stream has been set for this market. */
  readonly stream?: {
    readonly status: OptionsStreamStatus;
    readonly scheme: string;
    readonly id: string;
    readonly updatedAtMs?: number;
    readonly endedAtMs?: number;
  };
}

export interface OptionsLvstPanel {
  readonly account: string;
  readonly balanceLVST: number;
  readonly stakedLVST: number;
  readonly unstakedLVST: number;
  readonly pendingDividendsUSDC: number;
  readonly totalEarnedLVST?: number;
  readonly actions: {
    readonly canStake: boolean;
    readonly canUnstake: boolean;
    readonly canClaimDividends: boolean;
  };
}

export interface OptionsProtocolPanel {
  readonly marketCount: number;
  readonly vaultCount: number;
}

export interface OptionsUserPanel {
  readonly account: string;
  readonly marketId?: string;
  readonly usdcBalanceUSDC?: number;
}

export interface OptionsPanel {
  readonly account: string;
  readonly markets: readonly OptionsMarketPanel[];
  readonly nfts: readonly OptionsNftPanel[];
  readonly lvst: OptionsLvstPanel;
  readonly protocol?: OptionsProtocolPanel;
  readonly user: OptionsUserPanel;
}

export interface OptionsControlsView {
  readonly account: string;
  readonly revision: number;
  readonly functions: readonly OptionsFunctionView[];
}

export type OptionsFunctionTargetKind = "market" | "vault" | "nft" | "lvst" | "global";

export interface OptionsFunctionTarget {
  readonly kind: OptionsFunctionTargetKind;
  readonly marketId?: string;
  readonly vaultId?: string;
  readonly side?: OptionsVaultSide;
  readonly tokenId?: string;
}

export interface OptionsFunctionView {
  readonly name: string;
  readonly scope: string;
  readonly label: string;
  readonly input?: string;
  readonly target?: OptionsFunctionTarget;
  readonly disabled: boolean;
  readonly disabledReason?: string;
}
