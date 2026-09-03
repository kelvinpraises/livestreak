// --- exports ---

import type { LvstAccount } from "./lvst.js";
import type { MarketId, UserAddress } from "./ids.js";
import type { OptionsNft } from "./nft.js";
import type { OptionsMarket } from "./market.js";
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
}

export interface OptionsVaultSnapshot {
  readonly vault: OptionsVault;
  readonly pools: OptionsVaultPools;
  readonly shareTotals: OptionsVaultShareTotals;
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
  readonly protocol?: OptionsProtocolSummary;
}
