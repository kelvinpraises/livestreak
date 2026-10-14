import type Database from "better-sqlite3";
import { Migrator, sql, type Kysely } from "kysely";
import type { DB } from "../schema.js";
import * as baseline from "./2026-10-04T08:00:00+0000.js";

export const BASELINE_NAME = "2026-10-04T08:00:00+0000";
// Existing deployments can adopt the squash without replaying old migrations or deleting data.
const PREVIOUS_NAMES = new Set([
  "20260622T000000_init",
  "20260623T000000_vault_live_pools",
  "20260715T000000_steward_memory",
  "20260715T000100_forum_messages",
  "20261004T000000_catalog_integrity",
  "20261004T000100_documents",
]);

export async function migrateToLatest(db: Kysely<DB>): Promise<void> {
  const tables = await db.introspection.getTables({ withInternalKyselyTables: true });
  if (tables.some(table => table.name === "kysely_migration")) {
    await db.transaction().execute(async tx => {
      const applied = (await sql<{ name: string }>`SELECT name FROM kysely_migration`.execute(tx)).rows;
      if (applied.some(row => PREVIOUS_NAMES.has(row.name))) {
        if (applied.some(row => row.name !== BASELINE_NAME && !PREVIOUS_NAMES.has(row.name))) {
          throw new Error("Cannot adopt Host baseline: unrecognized migration history");
        }
        await baseline.up(tx);
        // Schema upgrade and replacement of the known old history are one transaction.
        for (const name of PREVIOUS_NAMES) await sql`DELETE FROM kysely_migration WHERE name = ${name}`.execute(tx);
        await sql`INSERT INTO kysely_migration(name, timestamp) VALUES (${BASELINE_NAME}, ${new Date().toISOString()}) ON CONFLICT(name) DO NOTHING`.execute(tx);
      }
    });
  }
  const migrator = new Migrator({ db, provider: { getMigrations: async () => ({ [BASELINE_NAME]: baseline }) } });
  const { error } = await migrator.migrateToLatest();
  if (error !== undefined) throw error instanceof Error ? error : new Error(String(error));
  // Alpha schema upgrades remain idempotent and preserve all rows on already-adopted baselines.
  await db.transaction().execute(tx => baseline.up(tx));
}

/** Explicit test-only synchronous setup uses exactly the same schema and upgrade rules. */
export function migrateSync(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    sqlite.exec(baseline.SCHEMA_DDL);
    const markets = sqlite.prepare("PRAGMA table_info(markets)").all() as { name: string; pk: number }[];
    const vaults = sqlite.prepare("PRAGMA table_info(vaults)").all() as { name: string }[];
    for (const statement of baseline.upgradeStatements(markets, vaults)) sqlite.exec(statement);
    const scopedColumns = Object.fromEntries(baseline.SCOPED_TABLES.map(table => [table,
      (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(column => column.name)]));
    for (const statement of baseline.scopeUpgradeStatements(scopedColumns)) sqlite.exec(statement);
  })();
}
