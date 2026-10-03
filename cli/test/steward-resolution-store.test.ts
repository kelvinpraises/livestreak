import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStewardResolutionStore } from "../src/adapters/steward-resolution-store.js";
let dir: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (dir) await rm(dir, { recursive: true, force: true });
});
it("survives a fresh store instance and isolates signer and deployment journals", async () => {
  dir = await mkdtemp(join(tmpdir(), "livestreak-resolution-store-"));
  vi.stubEnv("LIVESTREAK_STATE_DIR", dir);
  const store = createStewardResolutionStore("deployment-one", "steward-one");
  const attempt = {
    vaultId: "vault",
    recordDigest: `0x${"ab".repeat(32)}`,
    outcome: "yes" as const,
    status: "unknown" as const,
    txId: "actual-submitted-hash",
  };
  await store.save(attempt);
  expect(
    await createStewardResolutionStore("deployment-one", "steward-one").load("vault"),
  ).toEqual(attempt);
  expect(
    await createStewardResolutionStore("deployment-two", "steward-one").load("vault"),
  ).toBeNull();
  expect(
    await createStewardResolutionStore("deployment-one", "steward-two").load("vault"),
  ).toBeNull();
  expect(await store.load("other-vault")).toBeNull();
});
