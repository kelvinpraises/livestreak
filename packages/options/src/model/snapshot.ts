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
  /** Canonical unsettled funder depletion schedule per side (maxEnd + rate), read straight from the
   *  contract (Vault.getBoundaries). Every active funder — seed and all NFTs — so the live-pool
   *  projection caps at exactly what was funded, for any viewer (no per-user reconstruction). */
  readonly boundaries: {
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
