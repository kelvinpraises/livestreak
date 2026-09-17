// Single source of the discovery read-model DDL. Used by BOTH the kysely migration (boot
// path, with bookkeeping) and the synchronous `migrateSync` (so the sync deps builder used
// by tests has tables without an await). All statements are IF NOT EXISTS == idempotent.

export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS markets (
  id            TEXT PRIMARY KEY,
  chain         TEXT NOT NULL,
  route_id      TEXT NOT NULL,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL,
  stream_id     TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'none',
  is_live       INTEGER NOT NULL DEFAULT 0,
  watch_url     TEXT,
  active_vaults INTEGER NOT NULL DEFAULT 0,
  total_pooled  REAL NOT NULL DEFAULT 0,
  from_ms       INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vaults (
  id               TEXT PRIMARY KEY,
  market_id        TEXT NOT NULL,
  chain            TEXT NOT NULL,
  question         TEXT NOT NULL,
  side             TEXT,
  status           TEXT NOT NULL,
  resolved_outcome TEXT,
  yes_pool         TEXT NOT NULL DEFAULT '0',
  no_pool          TEXT NOT NULL DEFAULT '0',
  live_yes_pool    TEXT NOT NULL DEFAULT '0',
  live_no_pool     TEXT NOT NULL DEFAULT '0',
  expires_at_ms    INTEGER NOT NULL DEFAULT 0,
  resolved_at_ms   INTEGER,
  updated_at       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_vaults_market ON vaults (market_id);

CREATE TABLE IF NOT EXISTS resolutions (
  vault_id    TEXT PRIMARY KEY,
  market_id   TEXT NOT NULL,
  chain       TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  yes_total   TEXT NOT NULL DEFAULT '0',
  no_total    TEXT NOT NULL DEFAULT '0',
  resolved_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS steward_memory (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_kind     TEXT NOT NULL,
  subject_id       TEXT NOT NULL,
  market_id        TEXT,
  vault_id         TEXT,
  finding_ids      TEXT NOT NULL DEFAULT '[]',
  decision_actions TEXT NOT NULL DEFAULT '[]',
  evidence_refs    TEXT,
  at_ms            INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_steward_memory_subject ON steward_memory (subject_kind, subject_id);

CREATE TABLE IF NOT EXISTS forum_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  market_id    TEXT,
  vault_id     TEXT,
  steward_id   TEXT,
  finding_id   TEXT,
  title        TEXT,
  message      TEXT,
  at_ms        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_forum_messages_subject ON forum_messages (subject_kind, subject_id);
`;
