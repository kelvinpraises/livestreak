import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createKeystore, unlockKeystore } from '@livestreak/wallet'

// Small Argon2id params keep the test fast while exercising the real KDF + AEAD path.
const FAST = { opsLimit: 1, memLimit: 8192 }
const seed = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)

describe('keystore (Argon2id + XChaCha20-Poly1305 AEAD)', () => {
  it('round-trips: unlock(create(seed,pw),pw) deep-equals the seed', () => {
    const file = createKeystore(seed, 'correct horse', FAST)
    const unlocked = unlockKeystore(file, 'correct horse')
    assert.deepEqual(Uint8Array.from(unlocked.seed), seed)
    unlocked.lock()
  })

  it('does not mutate the caller seed', () => {
    const copy = Uint8Array.from(seed)
    createKeystore(seed, 'pw', FAST)
    assert.deepEqual(seed, copy)
  })

  it('wrong password throws a generic error (no seed leak in message)', () => {
    const file = createKeystore(seed, 'right', FAST)
    assert.throws(
      () => unlockKeystore(file, 'wrong'),
      (err) => /invalid password or corrupt keystore/.test(err.message) && !err.message.includes('3'),
    )
  })

  it('tampered ciphertext / nonce / kdfParams fail the AEAD tag', () => {
    const file = createKeystore(seed, 'pw', FAST)
    const flip = (b64) => {
      const buf = Buffer.from(b64, 'base64')
      buf[0] ^= 0xff
      return buf.toString('base64')
    }
    assert.throws(() => unlockKeystore({ ...file, ciphertextB64: flip(file.ciphertextB64) }, 'pw'))
    assert.throws(() => unlockKeystore({ ...file, nonceB64: flip(file.nonceB64) }, 'pw'))
    assert.throws(
      () => unlockKeystore({ ...file, kdfParams: { ...file.kdfParams, saltB64: flip(file.kdfParams.saltB64) } }, 'pw'),
    )
  })

  it('the KeystoreFile JSON contains no byte of the seed and no password', () => {
    const file = createKeystore(seed, 'sup3r-secret-pw', FAST)
    const json = JSON.stringify(file)
    assert.ok(!json.includes('sup3r-secret-pw'))
    // the seed bytes must not appear as a base64 substring anywhere in the file
    const seedB64 = Buffer.from(seed).toString('base64')
    assert.ok(!json.includes(seedB64))
  })

  it('lock() zeroizes the in-memory seed buffer', () => {
    const file = createKeystore(seed, 'pw', FAST)
    const unlocked = unlockKeystore(file, 'pw')
    assert.equal(unlocked.locked(), false)
    unlocked.lock()
    assert.equal(unlocked.locked(), true)
    assert.ok(Uint8Array.from(unlocked.seed).every((b) => b === 0))
  })
})
