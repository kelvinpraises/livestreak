import { Migrator, type Kysely, type Migration, type MigrationProvider } from "kysely";
import type Database from "better-sqlite3";
import type { DB } from "../schema.js";
import { SCHEMA_DDL } from "../ddl.js";
import * as init20260622 from "./20260622T000000_init.js";

// Static in-process migration provider (the agentix runner pattern, minus filesystem
// scanning so it works after bundling). Add new migrations here in timestamp order.
const MIGRATIONS: Record<string, Migration> = {
  "20260622T000000_init": init20260622
};

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return MIGRATIONS;
  }
}

// Run all pending migrations to latest on host startup. Idempotent: kysely records applied
// migrations in its own bookkeeping table, so a second boot is a no-op.
export const migrateToLatest = async (db: Kysely<DB>): Promise<void> => {
  const migrator = new Migrator({ db, provider: new StaticMigrationProvider() });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    if (r.status === "Error") {
      console.error(`[db]: migration failed: ${r.migrationName}`);
    }
  }
  if (error !== undefined) {
    throw error instanceof Error ? error : new Error(String(error));
  }
};

// Synchronous schema creation for the sync deps builder (tests): better-sqlite3 is
// synchronous, so we apply the shared DDL directly without an await. Idempotent.
export const migrateSync = (sqlite: Database.Database): void => {
  sqlite.exec(SCHEMA_DDL);
};
