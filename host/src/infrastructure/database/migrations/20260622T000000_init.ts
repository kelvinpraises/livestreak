import { sql, type Kysely } from "kysely";
import { SCHEMA_DDL } from "../ddl.js";

// Initial discovery read-model schema. The DDL lives in `../ddl.ts` (single source shared
// with the synchronous migrate path); this migration just executes it under kysely's
// bookkeeping so the boot-time `migrateToLatest` records it as applied.

export const up = async (db: Kysely<unknown>): Promise<void> => {
  // better-sqlite3's prepare() rejects multi-statement SQL, so run each DDL statement
  // individually (the sync `migrateSync` uses sqlite.exec which has no such limit).
  for (const stmt of SCHEMA_DDL.split(";")) {
    const trimmed = stmt.trim();
    if (trimmed.length > 0) {
      await sql.raw(trimmed).execute(db);
    }
  }
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable("resolutions").ifExists().execute();
  await db.schema.dropTable("vaults").ifExists().execute();
  await db.schema.dropTable("markets").ifExists().execute();
};
