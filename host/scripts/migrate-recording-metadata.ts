/** One-time R2 -> Turso metadata move. Video and playlists are never removed. */
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDatabase } from '../src/database/connection.js';
import { migrateToLatest } from '../src/database/migrations/index.js';
import { readStorageConfig } from '../src/config/host.js';
import { createS3ObjectStore, digest } from '../src/storage/object-store.js';

const config = readStorageConfig();
if (!config) throw new Error('Configure cloud storage');
const objects = createS3ObjectStore(config);
const client = new S3Client({ endpoint: config.endpoint, region: config.region, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
const database = createDatabase();
const keys = new Set<string>();
let imported = 0, removed = 0;
try {
  await migrateToLatest(database.db);
  for (const Prefix of ['recordings/', 'recording-markets/']) {
    let ContinuationToken: string | undefined;
    do {
      const result = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix, ContinuationToken }));
      for (const item of result.Contents ?? []) if (item.Key) keys.add(item.Key);
      ContinuationToken = result.NextContinuationToken;
    } while (ContinuationToken);
  }
  const backup = new URL(`../../context/archive/r2-metadata-${Date.now()}/`, import.meta.url);
  await mkdir(backup, { recursive: true });
  const records: { id: string; chain: string; marketId: string; runId: string; body: string; lease: number; keys: string[] }[] = [];
  for (const key of keys) {
    if (!/^recordings\/[a-f0-9]{64}\.json$/.test(key)) continue;
    const body = new TextDecoder().decode(await objects.get(key, 8 * 1024 * 1024));
    const state = JSON.parse(body);
    const expected = digest(new TextEncoder().encode(JSON.stringify([state.chain, state.marketId?.toLowerCase(), state.runId])));
    if (key !== `recordings/${expected}.json` || state.id !== expected || !['evm','solana','sui'].includes(state.chain) || !/^0x[a-f0-9]{64}$/.test(state.marketId) || !Array.isArray(state.parts) || !['recording','processing','ready','failed'].includes(state.status)) throw new Error(`Invalid legacy recording: ${key}`);
    const marketKey = `recording-markets/${state.chain}/${state.marketId}.json`;
    const owned = [key];
    if (keys.has(marketKey)) {
      const binding = await objects.get(marketKey);
      if (JSON.parse(new TextDecoder().decode(binding)).id !== state.id) throw new Error('Legacy market binding mismatch');
      await writeFile(new URL(`${state.id}-market.json`, backup), binding);
      owned.push(marketKey);
    }
    const leaseKey = `recordings/${state.id}.lease`;
    if (keys.has(leaseKey)) { owned.push(leaseKey); await writeFile(new URL(`${state.id}.lease`, backup), await objects.get(leaseKey)); }
    await writeFile(new URL(`${state.id}.json`, backup), body);
    records.push({ id: state.id, chain: state.chain, marketId: state.marketId, runId: state.runId, body, lease: keys.has(leaseKey) ? 1 : 0, keys: owned });
  }
  // Preserve every source first, then commit all records together. A conflict aborts before deletion.
  await database.db.transaction().execute(async tx => {
    for (const record of records) {
      await tx.insertInto('recordings').values({ id: record.id, chain: record.chain, market_id: record.marketId, run_id: record.runId, body: record.body, lease_claimed: record.lease }).onConflict(oc => oc.doNothing()).execute();
      const row = await tx.selectFrom('recordings').selectAll().where('id', '=', record.id).executeTakeFirstOrThrow();
      if (row.body !== record.body || row.lease_claimed !== record.lease) throw new Error('Destination metadata differs; source retained');
    }
  });
  await database.close();
  // Verify after reopening the real remote connection before removing any old metadata.
  const check = createDatabase();
  try {
    for (const record of records) {
      const row = await check.db.selectFrom('recordings').selectAll().where('id', '=', record.id).executeTakeFirstOrThrow();
      if (row.body !== record.body || row.chain !== record.chain || row.market_id !== record.marketId || row.lease_claimed !== record.lease) throw new Error('Metadata reopen verification failed');
      imported++;
    }
    for (const record of records) for (const key of record.keys) { await objects.remove(key); removed++; }
  } finally { await check.close(); }
  console.log(JSON.stringify({ importedRecordings: imported, removedMetadataObjects: removed, mediaObjectsRemoved: 0, unhandledMetadataObjects: keys.size - removed }));
} finally {
  client.destroy();
  await database.close();
}
