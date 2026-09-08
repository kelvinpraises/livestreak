import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import type { DB } from "./schema.js";

// better-sqlite3 + kysely SqliteDialect, mirroring the agentix connection. The file is
// `DATABASE_URL` or the named default; `:memory:` is honoured for tests (each call gets a
// fresh isolated db). WAL keeps the cron's writes from blocking page reads.

export const DEFAULT_DATABASE_FILE = "host-catalog.db";

export interface DatabaseHandle {
  readonly db: Kysely<DB>;
  readonly sqlite: Database.Database;
  close(): Promise<void>;
}

export const createDatabase = (url?: string): DatabaseHandle => {
  const file = url ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_FILE;
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
  return {
    db,
    sqlite,
    close: async () => {
      await db.destroy();
    }
  };
};
