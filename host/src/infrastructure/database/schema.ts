import type { ColumnType, Generated } from "kysely";

// Host-INTERNAL discovery read-model schema. The chain is the source of truth; these
// tables are a MATERIALIZED PROJECTION the cron lazily refreshes (see cron/catalog-sync).
// The app never sees these row types — it only sees the `@livestreak/host` contract
// shapes the mapper derives from these rows. Mirrors the agentix `infrastructure/database`
// layout: kysely table interfaces + a `DB` registry consumed by `connection.ts`.

export type ChainTag = "evm" | "sui";

// One row per market == one stream header on the homepage / stream page. `route_id` is
// what the app fetches `/stream/:id` by (== market_id). Per-stream aggregates
// (active_vaults / total_pooled) are STORED denormalized so a homepage read is a single
// scan with no per-market vault fan-in; they are recomputed by the indexer on every upsert.
export interface MarketsTable {
  id: string; // marketId — primary key
  chain: ChainTag;
  route_id: string;
  title: string;
  category: string;
  stream_id: string; // on-chain stream pointer id ("" when no stream set)
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
  id: string; // vaultId — primary key
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

// Append/upsert ledger of resolution events, keyed by vault. Kept SEPARATE from the
// `resolved_outcome` column on vaults (permutation note in the reply): vaults holds the
// current projection a live read serves; resolutions is the authoritative resolved-at
// ordering the homepage "lifetime" rail is built from, and survives a vault row refresh.
export interface ResolutionsTable {
  vault_id: string; // primary key
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
  markets: MarketsTable;
  vaults: VaultsTable;
  resolutions: ResolutionsTable;
  steward_memory: StewardMemoryTable;
  forum_messages: ForumMessagesTable;
}

// Re-export for the migration runner so a future table that needs an auto-increment id
// can reach for it without re-importing kysely directly.
export type { Generated };
