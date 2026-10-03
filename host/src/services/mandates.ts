import type Database from "better-sqlite3";
import { canonicalMandateBytes, mandateCommitment } from "@livestreak/schema";

/** Immutable, durable, small-document storage; the chain remains commitment authority. */
export const createMandateStore = (db: Database.Database) => {
  db.exec("CREATE TABLE IF NOT EXISTS vault_mandates (digest TEXT PRIMARY KEY, body BLOB NOT NULL)");
  return {
    async put(input: unknown) {
      const bytes = canonicalMandateBytes(input); const digest = await mandateCommitment(bytes);
      db.prepare("INSERT OR IGNORE INTO vault_mandates (digest, body) VALUES (?, ?)").run(digest, Buffer.from(bytes));
      const row = db.prepare("SELECT body FROM vault_mandates WHERE digest = ?").get(digest) as { body: Buffer };
      if (!row.body.equals(Buffer.from(bytes))) throw new Error("Mandate digest collision or corrupted storage");
      return { commitment: digest };
    },
    async get(digest: string) {
      if (!/^0x[0-9a-f]{64}$/.test(digest)) throw new Error("Invalid mandate digest");
      const row = db.prepare("SELECT body FROM vault_mandates WHERE digest = ?").get(digest) as { body: Buffer } | undefined;
      if (!row) return undefined;
      if (await mandateCommitment(row.body) !== digest) throw new Error("Corrupted mandate storage");
      const value: unknown = JSON.parse(row.body.toString("utf8"));canonicalMandateBytes(value);return value;
    }
  };
};
