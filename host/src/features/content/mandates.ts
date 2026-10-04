import { canonicalMandateBytes, mandateCommitment } from '@livestreak/schema';
import type { Kysely } from 'kysely';
import type { DB } from '../../database/schema.js';

/** The chain is commitment authority; immutable documents live in the configured database. */
export const createMandateStore = (db: Kysely<DB>) => ({
  async put(input: unknown) {
    const bytes = canonicalMandateBytes(input);
    const digest = await mandateCommitment(bytes);
    await db.insertInto('vault_mandates').values({ digest, body: bytes })
      .onConflict(conflict => conflict.column('digest').doNothing()).execute();
    const row = await db.selectFrom('vault_mandates').select('body').where('digest', '=', digest).executeTakeFirstOrThrow();
    if (!Buffer.from(row.body instanceof ArrayBuffer ? new Uint8Array(row.body) : row.body).equals(Buffer.from(bytes))) throw new Error('Mandate digest collision or corrupted storage');
    return { commitment: digest };
  },
  async get(digest: string) {
    if (!/^0x[0-9a-f]{64}$/.test(digest)) throw new Error('Invalid mandate digest');
    const row = await db.selectFrom('vault_mandates').select('body').where('digest', '=', digest).executeTakeFirst();
    if (!row) return undefined;
    const bytes = Buffer.from(row.body instanceof ArrayBuffer ? new Uint8Array(row.body) : row.body);
    if (await mandateCommitment(bytes) !== digest) throw new Error('Corrupted mandate storage');
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    canonicalMandateBytes(value);
    return value;
  },
});
