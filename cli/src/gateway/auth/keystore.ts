// Gateway keystore — thin disk consumer of @livestreak/wallet's encrypted-seed keystore (Objective 4,
// P2/P3). The crypto (Argon2id KEK + XChaCha20-Poly1305 AEAD) lives in the wallet NODE-ONLY subpath
// `@livestreak/wallet/keystore`; this module owns ONLY the disk path + perms + unlock lifecycle.
//
// SEED SAFETY: the encrypted file holds no plaintext; the unlocked seed lives in memory for the
// daemon's life and is zeroized on lock(). The keystore is stored OUTSIDE livestreak.json (whose
// FORBIDDEN_SERIALIZED_KEYS guard rejects seed/secret keys) so config never carries secrets.

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  createKeystore,
  unlockKeystore,
  type KeystoreFile,
  type UnlockedKeystore
} from "@livestreak/wallet/keystore";

// Default at-rest location: ~/.livestreak/keystore.json. Override with LIVESTREAK_KEYSTORE_PATH
// (used by tests to point at a temp dir).
export const defaultKeystorePath = (): string =>
  process.env["LIVESTREAK_KEYSTORE_PATH"] ?? join(homedir(), ".livestreak", "keystore.json");

export const readKeystoreFile = async (path: string): Promise<KeystoreFile | undefined> => {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  return JSON.parse(raw) as KeystoreFile;
};

// Encrypt `seed` under `password` and persist atomically with 0600 perms (dir 0700). Never logs the
// seed. Returns the written file path.
export const writeKeystoreFile = async (
  path: string,
  seed: Uint8Array,
  password: string
): Promise<string> => {
  const file = createKeystore(seed, password);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
  await chmod(tmp, 0o600);
  await (await import("node:fs/promises")).rename(tmp, path);
  await chmod(path, 0o600);
  return path;
};

export const keystoreExists = async (path: string): Promise<boolean> =>
  (await readKeystoreFile(path)) !== undefined;

// Unlock the at-rest keystore into memory. Throws a GENERIC error on wrong password / corruption (the
// wallet module never leaks an oracle beyond pass/fail). Caller MUST lock() when done.
export const unlockKeystoreAt = async (
  path: string,
  password: string
): Promise<UnlockedKeystore> => {
  const file = await readKeystoreFile(path);
  if (file === undefined) {
    throw new Error(`no keystore at ${path} — run a command that initializes it first`);
  }
  return unlockKeystore(file, password);
};

// Convenience for the daemon: ensure a keystore exists (creating it from `seed` if absent), then
// return the unlocked seed. The seed is derived elsewhere (operator password) on first init.
export const ensureAndUnlock = async (
  path: string,
  seed: Uint8Array,
  password: string
): Promise<UnlockedKeystore> => {
  if (!(await keystoreExists(path))) {
    await writeKeystoreFile(path, seed, password);
  }
  return unlockKeystoreAt(path, password);
};

export type { KeystoreFile, UnlockedKeystore };
