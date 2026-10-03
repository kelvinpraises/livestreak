import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createResolutionStore } from "../src/services/resolutions.js";
import { fixtureResolution } from "../../packages/schema/test/helpers/resolution.js";
it("retains immutable receipt bytes across restart, scopes discovery and detects corruption", async () => {
  const dir = mkdtempSync(join(tmpdir(), "livestreak-resolution-"));
  const file = join(dir, "state.db");
  let db = new Database(file);
  try {
    const r = await fixtureResolution();
    let store = createResolutionStore(db);
    const { digest } = await store.put(r);
    expect(await store.put(r)).toEqual({ digest });
    db.close();
    db = new Database(file);
    store = createResolutionStore(db);
    expect(await store.get(digest)).toEqual(r);
    expect(store.list(r.chainId, r.vaultId)).toEqual([digest]);
    expect(store.list("sui:localnet", r.vaultId)).toEqual([]);
    db.prepare("UPDATE resolution_records SET body=? WHERE digest=?").run(
      Buffer.from(JSON.stringify({ ...r, reason: "tampered" })),
      digest,
    );
    await expect(store.get(digest)).rejects.toThrow("digest mismatch");
    await expect(store.put(r)).rejects.toThrow("corrupted");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
