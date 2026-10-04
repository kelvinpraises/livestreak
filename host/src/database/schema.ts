import type { ColumnType, Generated, Insertable, Selectable } from "kysely";

// Host-INTERNAL discovery read-model schema. The chain is the source of truth; these
// tables are a MATERIALIZED PROJECTION the cron lazily refreshes (see cron/catalog-sync).
// The app never sees these row types — it only sees the `@livestreak/host` contract
// shapes the mapper derives from these rows. Kysely table definitions and row types
// live together here; `connection.ts` consumes the DB type.

export type ChainTag = "evm" | "sui" | "solana";

// One row per market == one stream header on the homepage / stream page. `route_id` is
// what the app fetches `/stream/:id` by (== market_id). Per-stream aggregates
// (active_vaults / total_pooled) are STORED denormalized so a homepage read is a single
// scan with no per-market vault fan-in; they are recomputed by the indexer on every upsert.
export interface MarketsTable {
  id: string; // marketId — keyed together with chain
  chain: ChainTag;
  route_id: string;
  title: string;
  category: string;
  stream_id: string; // on-chain stream pointer id ("" when no stream set)
  stream_scheme: string;
  ended_at_ms: ColumnType<number | null, number | null, number | null>;
  status: string; // OptionsStreamState.status: none|pending|live|ended
  is_live: ColumnType<number, number, number>; // 0|1 (sqlite has no bool)
  watch_url: ColumnType<string | null, string | null, string | null>;
  active_vaults: number;
  total_pooled: number; // USDC float (whole pool across this market's vaults)
  from_ms: number; // anchor for "elapsed" (stream updatedAt || market createdAt)
  updated_at: number; // last indexer write (ms)
}

// One row per on-chain vault. Pools are uint256 USDC base units that DO NOT fit a sqlite
// INTEGER, so they are stored as TEXT and parsed back to bigint/float by the mapper.
export interface VaultsTable {
  id: string; // vaultId — keyed together with chain
  market_id: string;
  chain: ChainTag;
  question: string;
  side: ColumnType<string | null, string | null, string | null>; // funded side hint, if any
  status: string; // open|hot|locked|resolved|...
  resolved_outcome: ColumnType<string | null, string | null, string | null>; // yes|no|null
  yes_pool: string; // uint256 base units as TEXT (settled / getVaultPools)
  no_pool: string; // uint256 base units as TEXT (settled)
  live_yes_pool: string; // board-replayed yes pool at index time (livePoolUSDC leg)
  live_no_pool: string; // board-replayed no pool at index time
  expires_at_ms: number;
  resolved_at_ms: ColumnType<number | null, number | null, number | null>;
  updated_at: number;
}

// Derived resolution projection, replaced atomically with its market and vaults.
// It orders the homepage results; it is not an independent event-history ledger.
export interface ResolutionsTable {
  vault_id: string; // keyed together with chain
  market_id: string;
  chain: ChainTag;
  outcome: string; // yes|no
  yes_total: string; // base units TEXT (frozen at resolution)
  no_total: string;
  resolved_at: number;
}

// Steward durable memory: one row per remember() — a subject's findings/decisions at a moment.
// findings/decisions/evidence are JSON-encoded TEXT (small arrays, read back whole).
export interface StewardMemoryTable {
  id: Generated<number>;
  subject_kind: string;
  subject_id: string;
  market_id: ColumnType<string | null, string | null, string | null>;
  vault_id: ColumnType<string | null, string | null, string | null>;
  finding_ids: string; // JSON string[]
  decision_actions: string; // JSON string[]
  evidence_refs: ColumnType<string | null, string | null, string | null>; // JSON string[]
  at_ms: number;
}

// Steward forum: openThread/appendMessage/annotate host actions land as messages about a subject.
export interface ForumMessagesTable {
  id: Generated<number>;
  kind: string; // thread | message | annotation
  subject_kind: string;
  subject_id: string;
  market_id: ColumnType<string | null, string | null, string | null>;
  vault_id: ColumnType<string | null, string | null, string | null>;
  steward_id: ColumnType<string | null, string | null, string | null>;
  finding_id: ColumnType<string | null, string | null, string | null>;
  title: ColumnType<string | null, string | null, string | null>;
  message: ColumnType<string | null, string | null, string | null>;
  at_ms: number;
}

export interface DB {
  recordings: { id: string; chain: string; market_id: string; run_id: string; body: string; lease_claimed: number };
  vault_mandates: { digest: string; body: Uint8Array | ArrayBuffer };
  resolution_records: { digest: string; chain_id: string; vault_id: string; body: Uint8Array | ArrayBuffer };
  markets: MarketsTable;
  vaults: VaultsTable;
  resolutions: ResolutionsTable;
  steward_memory: StewardMemoryTable;
  forum_messages: ForumMessagesTable;
}

export type Market = Selectable<MarketsTable>;
export type NewMarket = Insertable<MarketsTable>;

export type Vault = Selectable<VaultsTable>;
export type NewVault = Insertable<VaultsTable>;

export type Resolution = Selectable<ResolutionsTable>;
export type NewResolution = Insertable<ResolutionsTable>;
