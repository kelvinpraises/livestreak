import { afterEach, expect, it } from 'vitest';
import { createDatabase, type TestDatabaseHandle } from '../src/database/connection.js';
import { migrateSync, migrateToLatest } from '../src/database/migrations/index.js';
import { createCatalogReadModel } from '../src/features/catalog/read-model.js';
import { createRecordingService } from '../src/features/recordings/service.js';
import { testObjectStore } from './helpers/object-store.js';

const handles: TestDatabaseHandle[] = [];
afterEach(async () => { await Promise.all(handles.splice(0).map(handle => handle.close())); });
const database = () => {
  const handle = createDatabase(':memory:');
  migrateSync(handle.sqlite);
  handles.push(handle);
  return handle;
};
const marketId = `0x${'a'.repeat(64)}`;

it('keeps identical EVM IDs on two deployments distinct in the homepage and stream lookup', async () => {
  const { db } = database();
  const row = { chain: 'evm' as const, id: marketId, route_id: marketId, category: 'general', stream_id: '',
    stream_scheme: '', ended_at_ms: null, status: 'none', is_live: 0, watch_url: null, active_vaults: 0,
    total_pooled: 0, from_ms: 100, updated_at: Date.now() };
  await db.insertInto('markets').values([
    { ...row, deployment_scope: 'eip155:421614:registry', title: 'Arbitrum history' },
    { ...row, deployment_scope: 'eip155:10143:registry', title: 'Monad stream' },
    { ...row, deployment_scope: '', title: 'Unattributed legacy history' },
  ]).execute();
  const view = createCatalogReadModel({ db, deploymentScopes: { evm: 'eip155:10143:registry' } });
  const homepage = await view.homepage();
  expect(homepage.streams.map(stream => stream.title)).toEqual(['Monad stream']);
  expect((await view.stream(marketId, 'evm'))?.title).toBe('Monad stream');
  expect(await db.selectFrom('markets').selectAll().execute()).toHaveLength(3);
});

it('binds recording identities and lookup to the deployment without overwriting another network', async () => {
  const { db } = database();
  const store = testObjectStore();
  const scope = { chain: 'evm' as const, marketId, runId: 'same-observation' };
  const old = createRecordingService(store, 'secret', db, { evm: 'eip155:421614:registry' });
  const current = createRecordingService(store, 'secret', db, { evm: 'eip155:10143:registry' });
  const oldRecord = await old.begin(scope);
  expect(await current.forMarket('evm', marketId)).toBeNull();
  expect(await current.byId(oldRecord.id)).toBeNull();
  const newRecord = await current.begin(scope);
  expect(newRecord.id).not.toBe(oldRecord.id);
  expect((await old.forMarket('evm', marketId))?.id).toBe(oldRecord.id);
  expect((await current.forMarket('evm', marketId))?.id).toBe(newRecord.id);
  expect(await db.selectFrom('recordings').selectAll().execute()).toHaveLength(2);
});

it('upgrades previously applied recording keys atomically and preserves the original metadata', async () => {
  const handle = database();
  await migrateToLatest(handle.db);
  handle.sqlite.exec(`DROP TABLE recordings;
    CREATE TABLE recordings (id TEXT PRIMARY KEY, chain TEXT NOT NULL, market_id TEXT NOT NULL,
      run_id TEXT NOT NULL, body TEXT NOT NULL, lease_claimed INTEGER NOT NULL DEFAULT 0,
      UNIQUE(chain, market_id));`);
  handle.sqlite.prepare('INSERT INTO recordings(id,chain,market_id,run_id,body) VALUES (?,?,?,?,?)')
    .run('legacy-recording', 'evm', marketId, 'old-run', '{"preserved":true}');
  await migrateToLatest(handle.db);
  await migrateToLatest(handle.db);
  const row = await handle.db.selectFrom('recordings').selectAll().executeTakeFirstOrThrow();
  expect(row).toMatchObject({ id: 'legacy-recording', deployment_scope: '', body: '{"preserved":true}' });
});
