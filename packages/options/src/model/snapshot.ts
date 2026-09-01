// --- exports ---

import type { LvstAccount } from "./lvst.js";
import type { OptionsFundingStream } from "./funding.js";
import type { MarketId, UserAddress } from "./ids.js";
import type { OptionsMarket } from "./market.js";
import type { OptionsUserVaultPosition } from "./position.js";
import type { OptionsVault } from "./vault.js";

export interface OptionsProtocolSummary {
  readonly marketCount: number;
  readonly vaultCount: number;
}

export interface OptionsMarketSnapshot {
  readonly market: OptionsMarket;
  readonly vaults: readonly OptionsVault[];
}

export interface OptionsVaultFundingSnapshot {
  readonly yes: OptionsFundingStream;
  readonly no: OptionsFundingStream;
}

export interface OptionsVaultSnapshot {
  readonly vault: OptionsVault;
  readonly userPosition?: OptionsUserVaultPosition;
  readonly funding?: OptionsVaultFundingSnapshot;
}

export interface OptionsUserOptionsSnapshot {
  readonly account: UserAddress;
  readonly marketId?: MarketId;
  readonly markets: readonly OptionsMarketSnapshot[];
  readonly vaults: readonly OptionsVaultSnapshot[];
  readonly lvstAccount: LvstAccount;
  readonly protocol?: OptionsProtocolSummary;
}
