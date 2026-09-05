// MetaMask-style wallet keystore (Objective 4, P2).
//
// The gateway daemon holds live remote sessions and cannot re-prompt the seed per action, so the seed
// lives encrypted-at-rest and is unlocked into memory at start. Argon2id (memory-hard KEK) +
// XChaCha20-Poly1305 IETF AEAD, both via the already-present `sodium-universal` (NO new dependency).
//
// This module is fs-free and runtime-agnostic: it returns/accepts a serializable `KeystoreFile` JSON;
// the gateway (P3) owns the disk path & unlock lifecycle. Secrets are NEVER logged or thrown. See
// scope-foundations.md (C4).

import sodium from "sodium-universal";

// Serializable envelope the gateway writes to disk. No secret material in the clear; all base64.
export interface KeystoreFile {
  readonly version: 1;
  readonly kdf: "argon2id";
  readonly kdfParams: {
    readonly opsLimit: number;
    readonly memLimit: number;
    readonly saltB64: string;
  };
  readonly cipher: "xchacha20poly1305-ietf";
  readonly nonceB64: string;
  readonly ciphertextB64: string; // AEAD(seed) with AAD = canonical(version|kdf|kdfParams|cipher)
  readonly createdAtMs: number;
}

// Handle to an unlocked seed. Use the seed transiently (e.g. to build a wallet manager); do NOT retain
// it past lock(). lock() zeroizes the backing buffer.
export interface UnlockedKeystore {
  readonly seed: Uint8Array;
  readonly lock: () => void;
  readonly locked: () => boolean;
}

const KEYBYTES = sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES;
const NPUBBYTES = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
const ABYTES = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES;
const SALTBYTES = sodium.crypto_pwhash_SALTBYTES;

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const fromB64 = (text: string): Buffer => Buffer.from(text, "base64");

// Deterministic associated data binding the header to the ciphertext (a tampered header is rejected).
const associatedData = (
  version: 1,
  kdf: "argon2id",
  kdfParams: KeystoreFile["kdfParams"],
  cipher: "xchacha20poly1305-ietf"
): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({
      version,
      kdf,
      kdfParams: {
        opsLimit: kdfParams.opsLimit,
        memLimit: kdfParams.memLimit,
        saltB64: kdfParams.saltB64
      },
      cipher
    })
  );

const deriveKek = (
  password: string,
  salt: Uint8Array,
  opsLimit: number,
  memLimit: number
): Buffer => {
  const kek = Buffer.alloc(KEYBYTES);
  const passwordBytes = Buffer.from(password, "utf8");
  try {
    sodium.crypto_pwhash(kek, passwordBytes, salt, opsLimit, memLimit, sodium.crypto_pwhash_ALG_ARGON2ID13);
  } finally {
    sodium.sodium_memzero(passwordBytes);
  }
  return kek;
};

export interface CreateKeystoreParams {
  readonly opsLimit?: number;
  readonly memLimit?: number;
}

// Encrypt a seed at rest. Zeroizes the derived KEK and the plaintext copy before returning.
export const createKeystore = (
  seed: Uint8Array,
  password: string,
  params: CreateKeystoreParams = {}
): KeystoreFile => {
  const opsLimit = params.opsLimit ?? sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE;
  const memLimit = params.memLimit ?? sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE;

  const salt = Buffer.alloc(SALTBYTES);
  sodium.randombytes_buf(salt);
  const nonce = Buffer.alloc(NPUBBYTES);
  sodium.randombytes_buf(nonce);

  const kdfParams = { opsLimit, memLimit, saltB64: b64(salt) };
  const aad = associatedData(1, "argon2id", kdfParams, "xchacha20poly1305-ietf");

  const kek = deriveKek(password, salt, opsLimit, memLimit);
  const plaintext = Buffer.from(seed); // copy so we never mutate the caller's buffer
  const ciphertext = Buffer.alloc(plaintext.length + ABYTES);
  try {
    sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ciphertext, plaintext, aad, null, nonce, kek);
  } finally {
    sodium.sodium_memzero(kek);
    sodium.sodium_memzero(plaintext);
  }

  return {
    version: 1,
    kdf: "argon2id",
    kdfParams,
    cipher: "xchacha20poly1305-ietf",
    nonceB64: b64(nonce),
    ciphertextB64: b64(ciphertext),
    createdAtMs: Date.now()
  };
};

// Decrypt into memory. Throws a GENERIC error on wrong password / tampering (no oracle beyond pass/fail
// and no secret material in the message).
export const unlockKeystore = (file: KeystoreFile, password: string): UnlockedKeystore => {
  const salt = fromB64(file.kdfParams.saltB64);
  const nonce = fromB64(file.nonceB64);
  const ciphertext = fromB64(file.ciphertextB64);
  const aad = associatedData(file.version, file.kdf, file.kdfParams, file.cipher);

  const kek = deriveKek(password, salt, file.kdfParams.opsLimit, file.kdfParams.memLimit);
  const seed = Buffer.alloc(Math.max(0, ciphertext.length - ABYTES));
  try {
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(seed, null, ciphertext, aad, nonce, kek);
  } catch {
    sodium.sodium_memzero(seed);
    throw new Error("invalid password or corrupt keystore");
  } finally {
    sodium.sodium_memzero(kek);
  }

  let isLocked = false;
  return {
    seed,
    lock: () => {
      if (!isLocked) {
        sodium.sodium_memzero(seed);
        isLocked = true;
      }
    },
    locked: () => isLocked
  };
};
