// Minimal ambient types for the subset of sodium-universal the keystore uses (the package ships no
// type declarations). libsodium-style APIs write into a caller-allocated output buffer.
declare module "sodium-universal" {
  interface SodiumUniversal {
    readonly crypto_pwhash_SALTBYTES: number;
    readonly crypto_pwhash_ALG_ARGON2ID13: number;
    readonly crypto_pwhash_OPSLIMIT_INTERACTIVE: number;
    readonly crypto_pwhash_MEMLIMIT_INTERACTIVE: number;
    readonly crypto_aead_xchacha20poly1305_ietf_KEYBYTES: number;
    readonly crypto_aead_xchacha20poly1305_ietf_NPUBBYTES: number;
    readonly crypto_aead_xchacha20poly1305_ietf_ABYTES: number;
    crypto_pwhash(
      out: Uint8Array,
      passwd: Uint8Array,
      salt: Uint8Array,
      opslimit: number,
      memlimit: number,
      algorithm: number
    ): void;
    crypto_aead_xchacha20poly1305_ietf_encrypt(
      ciphertext: Uint8Array,
      message: Uint8Array,
      additionalData: Uint8Array | null,
      secretNonce: Uint8Array | null,
      publicNonce: Uint8Array,
      key: Uint8Array
    ): number;
    crypto_aead_xchacha20poly1305_ietf_decrypt(
      message: Uint8Array,
      secretNonce: Uint8Array | null,
      ciphertext: Uint8Array,
      additionalData: Uint8Array | null,
      publicNonce: Uint8Array,
      key: Uint8Array
    ): number;
    randombytes_buf(buffer: Uint8Array): void;
    sodium_memzero(buffer: Uint8Array): void;
  }
  const sodium: SodiumUniversal;
  export default sodium;
}
