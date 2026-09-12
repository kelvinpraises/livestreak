// --- exports ---

import type { LvstAccount } from "./lvst.js";
import type { MarketId, UserAddress } from "./ids.js";
import type { OptionsNft } from "./nft.js";
import type { OptionsMarket } from "./market.js";
import type { OptionsStreamState } from "./stream.js";
import type { OptionsBoardState } from "./math/accrual.js";
import type { FunderBoundary } from "./math/live-pool.js";
import type {
  OptionsVault,
  OptionsVaultPools,
  OptionsVaultShareTotals,
  OptionsVaultSide,
  OptionsVaultStewardState
} from "./vault.js";

export interface OptionsProtocolSummary {
  readonly marketCount: number;
  readonly vaultCount: number;
}

export interface OptionsMarketSnapshot {
  readonly market: OptionsMarket;
  readonly vaults: readonly OptionsVault[];
  /** Raw stream pointer for this market. Undefined when none has been set on-chain. */
  readonly streamState?: OptionsStreamState;
}

export interface OptionsVaultSnapshot {
  readonly vault: OptionsVault;
  readonly pools: OptionsVaultPools;
  readonly shareTotals: OptionsVaultShareTotals;
  readonly boards: {
    readonly yes: OptionsBoardState;
    readonly no: OptionsBoardState;
  };
  readonly pendingBoundaries: {
    readonly yes: bigint;
    readonly no: bigint;
  };
  /** Creator-seed funding boundaries per side (maxEnd + rate). Feeds the live-pool projection so the
   *  pool stops growing once the seed's deposit runs dry — it never exceeds what was funded. Absent on
   *  chains/readers that don't surface it (the projection then falls back to the uncapped path). */
  readonly seedBoundaries?: {
    readonly yes: readonly FunderBoundary[];
    readonly no: readonly FunderBoundary[];
  };
  readonly hot: OptionsVaultStewardState;
  readonly dispute: Pick<OptionsVaultStewardState, "disputeId"> & { readonly active: boolean };
  readonly winningSide?: OptionsVaultSide;
  readonly pot?: bigint;
  readonly collected?: boolean;
}

export interface OptionsNftSnapshot {
  readonly nft: OptionsNft;
}

export interface OptionsUserOptionsSnapshot {
  readonly account: UserAddress;
  readonly marketId?: MarketId;
  readonly markets: readonly OptionsMarketSnapshot[];
  readonly vaults: readonly OptionsVaultSnapshot[];
  readonly nfts: readonly OptionsNftSnapshot[];
  readonly lvstAccount: LvstAccount;
  readonly usdcBalance?: bigint;
  readonly protocol?: OptionsProtocolSummary;
}
