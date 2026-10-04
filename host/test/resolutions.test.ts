import { expect, it } from "vitest";
import { createTestDatabase } from "./helpers/database.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createResolutionStore } from "../src/features/content/resolutions.js";
import { fixtureResolution } from "../../packages/schema/test/helpers/resolution.js";
it("retains immutable receipt bytes across restart, scopes discovery and detects corruption", async () => {
  const dir = mkdtempSync(join(tmpdir(), "livestreak-resolution-"));
  const file = join(dir, "state.db");
  let db = createTestDatabase(file);
  try {
    const r = await fixtureResolution();
    let store = createResolutionStore(db.db);
    const { digest } = await store.put(r);
    expect(await store.put(r)).toEqual({ digest });
    await db.close();
    db = createTestDatabase(file);
    store = createResolutionStore(db.db);
    expect(await store.get(digest)).toEqual(r);
    expect(await store.list(r.chainId, r.vaultId)).toEqual([digest]);
    expect(await store.list("sui:localnet", r.vaultId)).toEqual([]);
    db.sqlite.prepare("UPDATE resolution_records SET body=? WHERE digest=?").run(
      Buffer.from(JSON.stringify({ ...r, reason: "tampered" })),
      digest,
    );
    await expect(store.get(digest)).rejects.toThrow("digest mismatch");
    await expect(store.put(r)).rejects.toThrow("corrupted");
  } finally {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
