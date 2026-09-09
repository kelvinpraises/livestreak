import { sql, type Kysely } from "kysely";

// Add board-replayed live pool columns so the homepage read-model can serve effective
// pool totals without re-querying boards on every page load. Idempotent: migrateSync
// may already create these via ddl.ts; migrateToLatest only adds when missing.

const vaultColumnNames = async (db: Kysely<unknown>): Promise<Set<string>> => {
  const result = await sql<{ name: string }>`PRAGMA table_info(vaults)`.execute(db);
  return new Set(result.rows.map((row) => row.name));
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  const names = await vaultColumnNames(db);
  if (!names.has("live_yes_pool")) {
    await sql`ALTER TABLE vaults ADD COLUMN live_yes_pool TEXT NOT NULL DEFAULT '0'`.execute(db);
  }
  if (!names.has("live_no_pool")) {
    await sql`ALTER TABLE vaults ADD COLUMN live_no_pool TEXT NOT NULL DEFAULT '0'`.execute(db);
  }
};

export const down = async (_db: Kysely<unknown>): Promise<void> => {
  // SQLite cannot drop columns without a table rebuild; leave as no-op for dev rollback.
};
