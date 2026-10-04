import { afterEach, expect, it, vi } from 'vitest';
import { createDatabase } from '../src/database/connection.js';
afterEach(() => vi.unstubAllEnvs());
it('requires a configured remote connection instead of inventing a file', () => {
  vi.stubEnv('TURSO_DATABASE_URL', undefined);
  vi.stubEnv('DATABASE_URL', undefined);
  expect(() => createDatabase()).toThrow('Configure TURSO_DATABASE_URL');
});
it.each(['host.db', 'file:host.db', 'http://localhost:8080'])('rejects local or insecure connection %s', url => {
  expect(() => createDatabase(url)).toThrow('Database URL');
});
it('requires authentication for a remote database', () => {
  vi.stubEnv('TURSO_AUTH_TOKEN', undefined);
  expect(() => createDatabase('libsql://example.turso.io')).toThrow('TURSO_AUTH_TOKEN');
});

it('rejects conflicting URL aliases instead of silently choosing a database', () => {
  vi.stubEnv('TURSO_DATABASE_URL', 'libsql://first.turso.io');
  vi.stubEnv('DATABASE_URL', 'libsql://second.turso.io');
  expect(() => createDatabase()).toThrow('disagree');
});
