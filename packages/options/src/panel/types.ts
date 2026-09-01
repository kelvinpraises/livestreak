// --- exports ---

import type {
  OptionsMarketStatus,
  OptionsVaultOutcome,
  OptionsVaultSide,
  OptionsVaultStatus,
  OptionsVaultType
} from "../model/index.js";

export interface OptionsSidePanel {
  readonly side: OptionsVaultSide;
  readonly streamedUSDC: string;
  readonly shares: string;
  readonly currentValueUSDC: string;
  readonly claimableUSDC: string;
  readonly lossClaimableLVST: string;
  readonly fundingRatePerMinuteUSDC: string;
  readonly fundingActive: boolean;
  readonly streamPaused: boolean;
  readonly isWinningSide: boolean | null;
  readonly released: boolean;
}

export interface OptionsVaultUserPanel {
  readonly account: string;
  readonly positions: {
    readonly yes: OptionsSidePanel;
    readonly no: OptionsSidePanel;
  };
  readonly totals: {
    readonly streamedUSDC: string;
    readonly shares: string;
    readonly currentValueUSDC: string;
    readonly claimableUSDC: string;
    readonly lossClaimableLVST: string;
  };
  readonly activeFunding: {
    readonly yesRatePerMinuteUSDC: string;
    readonly noRatePerMinuteUSDC: string;
    readonly totalRatePerMinuteUSDC: string;
    readonly anyActive: boolean;
    readonly allPaused: boolean;
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
    readonly yesUSDC: string;
    readonly noUSDC: string;
    readonly totalUSDC: string;
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
    readonly disputeId?: string;
  };
  readonly user?: OptionsVaultUserPanel;
}

export interface OptionsMarketPanel {
  readonly marketId: string;
  readonly title: string;
  readonly streamId?: string;
  readonly category?: string;
  readonly status: OptionsMarketStatus;
  readonly vaultIds: readonly string[];
  readonly totals: {
    readonly pooledUSDC: string;
    readonly activeVaults: number;
    readonly resolvedVaults: number;
  };
  readonly timing?: {
    readonly createdAtMs?: number;
    readonly closesAtMs?: number;
    readonly resolvedAtMs?: number;
  };
  readonly vaults: readonly OptionsVaultPanel[];
}

export interface OptionsLvstPanel {
  readonly account: string;
  readonly balanceLVST: string;
  readonly stakedLVST: string;
  readonly unstakedLVST: string;
  readonly pendingDividendsUSDC: string;
  readonly totalEarnedLVST?: string;
  readonly lossClaims: {
    readonly claimableLVST: string;
    readonly claimedLVST: string;
    readonly stakedFromClaimsLVST: string;
  };
}

export interface OptionsProtocolPanel {
  readonly marketCount: number;
  readonly vaultCount: number;
}

export interface OptionsUserPanel {
  readonly account: string;
  readonly marketId?: string;
}

export interface OptionsPanel {
  readonly account: string;
  readonly markets: readonly OptionsMarketPanel[];
  readonly lvst: OptionsLvstPanel;
  readonly protocol?: OptionsProtocolPanel;
  readonly user: OptionsUserPanel;
}
