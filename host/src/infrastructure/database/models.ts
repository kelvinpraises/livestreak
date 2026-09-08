import type { Insertable, Selectable, Updateable } from "kysely";
import type { MarketsTable, ResolutionsTable, VaultsTable } from "./schema.js";

// Host-internal row aliases (the agentix `models/` pattern): `Selectable` is what a query
// returns, `Insertable`/`Updateable` are what the indexer writes. Keeps every query/upsert
// site typed without re-deriving kysely helpers inline.

export type Market = Selectable<MarketsTable>;
export type NewMarket = Insertable<MarketsTable>;
export type MarketUpdate = Updateable<MarketsTable>;

export type Vault = Selectable<VaultsTable>;
export type NewVault = Insertable<VaultsTable>;
export type VaultUpdate = Updateable<VaultsTable>;

export type Resolution = Selectable<ResolutionsTable>;
export type NewResolution = Insertable<ResolutionsTable>;
export type ResolutionUpdate = Updateable<ResolutionsTable>;
