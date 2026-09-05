// --- exports ---

import type {
  OptionsMarketStatus,
  OptionsStreamStatus,
  OptionsVaultOutcome,
  OptionsVaultSide,
  OptionsVaultStatus,
  OptionsVaultType
} from "../../model/index.js";

export interface OptionsLanePanel {
  readonly vaultId: string;
  readonly side: OptionsVaultSide;
  readonly rate: string;
  readonly sharesAccrued: string;
  readonly depleted: boolean;
  readonly maxEndMs?: number;
  readonly claimableUSDC?: string;
  readonly lossClaimableLVST?: string;
  readonly won?: boolean;
  readonly canClaimWin?: boolean;
  readonly canClaimLoss?: boolean;
}

export interface OptionsNftPanel {
  readonly tokenId: string;
  readonly marketId: string;
  readonly laneCount: number;
  readonly lanes: readonly OptionsLanePanel[];
  readonly owner: string;
  readonly approved?: string;
  readonly isOperator?: boolean;
  /** Shared Drips account balance in USDC raw units (string). EVM only; absent on Sui. */
  readonly balanceUSDC?: string;
  /** Account-level runway as ms-since-epoch when the balance runs out. EVM only; absent on Sui. */
  readonly runwayEndMs?: number;
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
    readonly yesUSDC: string;
    readonly noUSDC: string;
    readonly totalUSDC: string;
    readonly sharePriceYes: string;
    readonly sharePriceNo: string;
  };
  readonly shareTotals: {
    readonly yes: string;
    readonly no: string;
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
    readonly pooledUSDC: string;
    readonly totalPooledUSDC: string;
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
  readonly balanceLVST: string;
  readonly stakedLVST: string;
  readonly unstakedLVST: string;
  readonly pendingDividendsUSDC: string;
  readonly totalEarnedLVST?: string;
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
  readonly usdcBalanceUSDC?: string;
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
