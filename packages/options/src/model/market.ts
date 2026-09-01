// --- exports ---

import type { MarketId } from "./ids.js";
import type { VaultId } from "./ids.js";

export type OptionsMarketStatus = "open" | "locked" | "resolved" | "disputed";

export interface OptionsMarketTiming {
  readonly createdAtMs?: number;
  readonly closesAtMs?: number;
  readonly resolvedAtMs?: number;
}

export interface OptionsMarket {
  readonly marketId: MarketId;
  readonly title: string;
  readonly streamId?: string;
  readonly category?: string;
  readonly status: OptionsMarketStatus;
  readonly vaultIds: readonly VaultId[];
  readonly timing?: OptionsMarketTiming;
}
