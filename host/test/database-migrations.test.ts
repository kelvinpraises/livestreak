import { afterEach, expect, it } from 'vitest';
import { createDatabase, type TestDatabaseHandle } from '../src/database/connection.js';
import { BASELINE_NAME, migrateToLatest } from '../src/database/migrations/index.js';

const handles: TestDatabaseHandle[] = [];
afterEach(async () => {
  await Promise.all(handles.splice(0).map(handle => handle.close()));
});
function database() {
  const handle = createDatabase(':memory:');
  handles.push(handle);
  return handle;
}
function history(handle: TestDatabaseHandle) {
  return handle.sqlite.prepare('SELECT name FROM kysely_migration ORDER BY name').all();
}
it('creates the full schema in one migration and repeated boots preserve documents', async () => {
  const handle = database();
  await migrateToLatest(handle.db);
  const tables = (await handle.db.introspection.getTables()).map(table => table.name);
  expect(tables).toEqual(expect.arrayContaining(['markets', 'vaults', 'resolutions', 'steward_memory', 'forum_messages', 'vault_mandates', 'resolution_records']));
  await handle.db.insertInto('vault_mandates').values({ digest: 'proof', body: Buffer.from('preserved') }).execute();
  await migrateToLatest(handle.db);
  expect(history(handle)).toEqual([{ name: BASELINE_NAME }]);
  expect((await handle.db.selectFrom('vault_mandates').selectAll().executeTakeFirstOrThrow()).body).toEqual(Buffer.from('preserved'));
});
it('adopts all six prior migration records without losing stored data', async () => {
  const handle = database();
  await migrateToLatest(handle.db);
  await handle.db.insertInto('resolution_records').values({ digest: 'receipt', chain_id: 'evm', vault_id: 'v', body: Buffer.from('evidence') }).execute();
  handle.sqlite.prepare('DELETE FROM kysely_migration').run();
  for (const name of ['20260622T000000_init', '20260623T000000_vault_live_pools', '20260715T000000_steward_memory', '20260715T000100_forum_messages', '20261004T000000_catalog_integrity', '20261004T000100_documents']) {
    handle.sqlite.prepare('INSERT INTO kysely_migration(name,timestamp) VALUES (?,?)').run(name, new Date().toISOString());
  }
  await migrateToLatest(handle.db);
  await migrateToLatest(handle.db);
  expect(history(handle)).toEqual([{ name: BASELINE_NAME }]);
  expect((await handle.db.selectFrom('resolution_records').selectAll().executeTakeFirstOrThrow()).body).toEqual(Buffer.from('evidence'));
});
it('refuses unknown history without erasing existing migration records', async () => {
  const handle = database();
  await migrateToLatest(handle.db);
  handle.sqlite.prepare('UPDATE kysely_migration SET name = ?').run('20260622T000000_init');
  handle.sqlite.prepare('INSERT INTO kysely_migration(name,timestamp) VALUES (?,?)').run('unknown-change', new Date().toISOString());
  const before = history(handle);
  await expect(migrateToLatest(handle.db)).rejects.toThrow('unrecognized migration history');
  expect(history(handle)).toEqual(before);
});
