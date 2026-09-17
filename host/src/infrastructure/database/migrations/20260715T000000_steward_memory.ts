import { sql, type Kysely } from "kysely";

// Steward durable memory (replaces the Walrus MemWal leg). Idempotent: migrateSync may
// already create the table via ddl.ts; this records it in the migrator bookkeeping.

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`CREATE TABLE IF NOT EXISTS steward_memory (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_kind     TEXT NOT NULL,
    subject_id       TEXT NOT NULL,
    market_id        TEXT,
    vault_id         TEXT,
    finding_ids      TEXT NOT NULL DEFAULT '[]',
    decision_actions TEXT NOT NULL DEFAULT '[]',
    evidence_refs    TEXT,
    at_ms            INTEGER NOT NULL DEFAULT 0
  )`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_steward_memory_subject
    ON steward_memory (subject_kind, subject_id)`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`DROP TABLE IF EXISTS steward_memory`.execute(db);
};
