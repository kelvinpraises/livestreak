import { LibsqlDialect } from '@libsql/kysely-libsql';
import type Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { createRequire } from 'node:module';
import type { DB } from './schema.js';

export interface DatabaseHandle {
  readonly db: Kysely<DB>;
  close(): Promise<void>;
}
export interface TestDatabaseHandle extends DatabaseHandle {
  readonly sqlite: Database.Database;
}

export function createDatabase(url: ':memory:'): TestDatabaseHandle;
export function createDatabase(url?: string): DatabaseHandle;
export function createDatabase(url?: string): DatabaseHandle {
  // Explicit, isolated unit-test storage. Never a production fallback or replica.
  if (url === ':memory:') {
    if (process.env.VITEST === undefined && process.env.NODE_ENV !== 'test') {
      throw new Error('In-memory database is available only to tests');
    }
    const SQLite = createRequire(import.meta.url)('better-sqlite3') as typeof Database;
    const sqlite = new SQLite(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    return { db, sqlite, close: () => db.destroy() } as TestDatabaseHandle;
  }
  if (url === undefined && process.env.TURSO_DATABASE_URL && process.env.DATABASE_URL &&
      process.env.TURSO_DATABASE_URL !== process.env.DATABASE_URL) {
    throw new Error('TURSO_DATABASE_URL and DATABASE_URL disagree; configure one connection URL');
  }
  const endpoint = url ?? process.env.TURSO_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!endpoint?.trim()) throw new Error('Configure TURSO_DATABASE_URL or DATABASE_URL');
  let parsed: URL;
  try { parsed = new URL(endpoint); } catch { throw new Error('Database URL must be a remote libSQL URL'); }
  if (!['libsql:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error('Database URL must use libsql:// or https://; local files are not supported');
  }
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!authToken?.trim()) throw new Error('Configure TURSO_AUTH_TOKEN');
  const db = new Kysely<DB>({ dialect: new LibsqlDialect({ url: endpoint, authToken }) });
  return { db, close: () => db.destroy() };
}
