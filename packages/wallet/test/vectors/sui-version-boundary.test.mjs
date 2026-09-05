import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

import WalletAccountSui from '../../src/vendor/sui/wallet-account-sui.js'

// F1/C9: the @mysten/sui split stays v1(wallet)/v2(contracts/host) for the hackathon. The seam is
// SOUND because only raw key BYTES cross it (never SDK objects, which would fail instanceof/BCS across
// majors). This locks that contract so a future object-crossing refactor fails loudly.
// (The true cross-major v1≡v2 re-derivation belongs in host/, which resolves both majors — filed there.)

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const TEST_PATH = "0'/0/0"
const GOLDEN_SUI_ADDRESS =
  '0x5e93a736d04fbb25737aa40bee40171ef79f65fae833749e3c089fe7cc2161f1'

describe('Sui version boundary (bytes-only crossing)', () => {
  it('the crossing surface exposes raw bytes, not an SDK object', async () => {
    const account = await WalletAccountSui.at(TEST_MNEMONIC, TEST_PATH, {})
    assert.ok(account._rawPrivateKey instanceof Uint8Array)
    assert.equal(account._rawPrivateKey.length, 32)
  })

  it('re-importing the raw secret-key bytes (v1) re-derives the golden address', async () => {
    const account = await WalletAccountSui.at(TEST_MNEMONIC, TEST_PATH, {})
    const reimported = Ed25519Keypair.fromSecretKey(Uint8Array.from(account._rawPrivateKey))
    assert.equal(reimported.getPublicKey().toSuiAddress(), GOLDEN_SUI_ADDRESS)
  })
})
