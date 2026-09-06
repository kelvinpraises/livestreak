import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureAndUnlock,
  keystoreExists,
  unlockKeystoreAt,
  writeKeystoreFile
} from "../src/gateway/keystore.js";

const seed = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);

describe("gateway/keystore (consumes @livestreak/wallet/keystore subpath)", () => {
  let path: string;

  beforeEach(() => {
    path = join(mkdtempSync(join(tmpdir(), "ls-ks-")), "keystore.json");
    process.env["LIVESTREAK_KEYSTORE_PATH"] = path;
  });

  afterEach(() => {
    delete process.env["LIVESTREAK_KEYSTORE_PATH"];
  });

  it("writes then unlocks the seed with the correct password", async () => {
    await writeKeystoreFile(path, seed, "hunter2");
    expect(await keystoreExists(path)).toBe(true);
    const unlocked = await unlockKeystoreAt(path, "hunter2");
    expect(Array.from(unlocked.seed)).toEqual(Array.from(seed));
    unlocked.lock();
    expect(unlocked.locked()).toBe(true);
    // lock() zeroizes the backing buffer.
    expect(unlocked.seed.every((b) => b === 0)).toBe(true);
  });

  it("rejects a wrong password generically (no oracle, no secret in message)", async () => {
    await writeKeystoreFile(path, seed, "right");
    await expect(unlockKeystoreAt(path, "wrong")).rejects.toThrow(/invalid password or corrupt/i);
  });

  it("ensureAndUnlock creates on first run then reuses the same file", async () => {
    expect(await keystoreExists(path)).toBe(false);
    const first = await ensureAndUnlock(path, seed, "pw");
    expect(Array.from(first.seed)).toEqual(Array.from(seed));
    first.lock();
    // Second call must NOT recreate — a different seed arg is ignored once the file exists.
    const second = await ensureAndUnlock(path, new Uint8Array(32), "pw");
    expect(Array.from(second.seed)).toEqual(Array.from(seed));
    second.lock();
  });

  it("never persists the seed in cleartext", async () => {
    await writeKeystoreFile(path, seed, "pw");
    const raw = (await import("node:fs/promises")).readFile;
    const text = await raw(path, "utf8");
    expect(text).not.toContain(Buffer.from(seed).toString("hex"));
    expect(text).not.toContain(Buffer.from(seed).toString("base64"));
  });
});
