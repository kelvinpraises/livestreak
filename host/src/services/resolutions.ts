import type Database from "better-sqlite3";
import {
  canonicalResolutionBytes,
  resolutionDigest,
  verifyResolutionRecord,
} from "@livestreak/schema";
export const createResolutionStore = (db: Database.Database) => {
  db.exec(
    "CREATE TABLE IF NOT EXISTS resolution_records (digest TEXT PRIMARY KEY, chain_id TEXT NOT NULL, vault_id TEXT NOT NULL, body BLOB NOT NULL); CREATE INDEX IF NOT EXISTS resolution_scope ON resolution_records(chain_id,vault_id)",
  );
  return {
    async put(input: unknown) {
      const record = await verifyResolutionRecord(input);
      const bytes = canonicalResolutionBytes(record);
      const digest = await resolutionDigest(record);
      db.prepare(
        "INSERT OR IGNORE INTO resolution_records (digest,chain_id,vault_id,body) VALUES (?,?,?,?)",
      ).run(digest, record.chainId, record.vaultId, Buffer.from(bytes));
      const row = db
        .prepare("SELECT body FROM resolution_records WHERE digest=?")
        .get(digest) as { body: Buffer };
      if (!row.body.equals(Buffer.from(bytes)))
        throw new Error("Resolution collision or corrupted storage");
      return { digest };
    },
    async get(digest: string) {
      if (!/^0x[0-9a-f]{64}$/.test(digest)) throw new Error("Invalid resolution digest");
      const row = db
        .prepare("SELECT body FROM resolution_records WHERE digest=?")
        .get(digest) as { body: Buffer } | undefined;
      return row
        ? verifyResolutionRecord(JSON.parse(row.body.toString("utf8")), digest)
        : undefined;
    },
    list(chainId: string, vaultId: string) {
      if (
        !/^(eip155|solana|sui):[^\s]{1,256}$/.test(chainId) ||
        !vaultId.trim() ||
        vaultId.length > 4096
      )
        throw new Error("Invalid resolution scope");
      return (
        db
          .prepare(
            "SELECT digest FROM resolution_records WHERE chain_id=? AND vault_id=? ORDER BY rowid DESC LIMIT 20",
          )
          .all(chainId, vaultId) as { digest: string }[]
      ).map((row) => row.digest);
    },
  };
};
