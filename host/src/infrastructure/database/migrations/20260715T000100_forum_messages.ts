import { sql, type Kysely } from "kysely";

// Steward forum messages (openThread/appendMessage/annotate host actions). Idempotent:
// migrateSync may already create the table via ddl.ts.

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`CREATE TABLE IF NOT EXISTS forum_messages (
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
  )`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_forum_messages_subject
    ON forum_messages (subject_kind, subject_id)`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`DROP TABLE IF EXISTS forum_messages`.execute(db);
};
