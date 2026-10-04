import type { TestDatabaseHandle } from '../../src/database/connection.js';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { migrateSync } from '../../src/database/migrations/index.js';
import type { DB } from '../../src/database/schema.js';

/** File persistence tests only. Production accepts remote URLs exclusively. */
export function createTestDatabase(file: string): TestDatabaseHandle {
  const sqlite = new Database(file);
  migrateSync(sqlite);
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
  return { sqlite, db, close: () => db.destroy() };
}
