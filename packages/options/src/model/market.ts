// --- exports ---

import type { MarketId, UserAddress, VaultId } from "./ids.js";

export type OptionsMarketStatus = "open" | "locked" | "resolved" | "disputed";

export interface OptionsMarketTiming {
  readonly createdAtMs?: number;
  readonly closesAtMs?: number;
  readonly resolvedAtMs?: number;
}

export interface OptionsMarket {
  readonly marketId: MarketId;
  readonly title: string;
  readonly creator: UserAddress;
  readonly streamId?: string;
  readonly category?: string;
  readonly status: OptionsMarketStatus;
  readonly vaultIds: readonly VaultId[];
  readonly timing?: OptionsMarketTiming;
}
