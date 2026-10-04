import { canonicalResolutionBytes, resolutionDigest, verifyResolutionRecord } from '@livestreak/schema';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../database/schema.js';

export const createResolutionStore = (db: Kysely<DB>) => ({
  async put(input: unknown) {
    const record = await verifyResolutionRecord(input);
    const bytes = canonicalResolutionBytes(record);
    const digest = await resolutionDigest(record);
    await db.insertInto('resolution_records').values({ digest, chain_id: record.chainId, vault_id: record.vaultId, body: bytes })
      .onConflict(conflict => conflict.column('digest').doNothing()).execute();
    const row = await db.selectFrom('resolution_records').select('body').where('digest', '=', digest).executeTakeFirstOrThrow();
    if (!Buffer.from(row.body instanceof ArrayBuffer ? new Uint8Array(row.body) : row.body).equals(Buffer.from(bytes))) throw new Error('Resolution collision or corrupted storage');
    return { digest };
  },
  async get(digest: string) {
    if (!/^0x[0-9a-f]{64}$/.test(digest)) throw new Error('Invalid resolution digest');
    const row = await db.selectFrom('resolution_records').select('body').where('digest', '=', digest).executeTakeFirst();
    return row ? verifyResolutionRecord(JSON.parse(Buffer.from(row.body instanceof ArrayBuffer ? new Uint8Array(row.body) : row.body).toString('utf8')), digest) : undefined;
  },
  async list(chainId: string, vaultId: string) {
    if (!/^(eip155|solana|sui):[^\s]{1,256}$/.test(chainId) || !vaultId.trim() || vaultId.length > 4096) throw new Error('Invalid resolution scope');
    const rows = await db.selectFrom('resolution_records').select('digest')
      .where('chain_id', '=', chainId).where('vault_id', '=', vaultId)
      .orderBy(sql`rowid`, 'desc').limit(20).execute();
    return rows.map(row => row.digest);
  },
});
