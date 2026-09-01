import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import WalletAccountSui from '../../src/vendor/sui/wallet-account-sui.js'

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const TEST_PATH = "0'/0/0" // SLIP-0010 hardened -> m/44'/784'/0'/0'/0'
const TEST_MESSAGE = 'livestreak-vector-v1'

// Captured from the vendored Sui WDK (Ed25519 / signPersonalMessage is deterministic).
export const GOLDEN_SUI_ADDRESS =
  '0x5e93a736d04fbb25737aa40bee40171ef79f65fae833749e3c089fe7cc2161f1'
export const GOLDEN_SUI_SIGNATURE =
  'ANh3cPatCzoP7MGccRO9WD/+iY9QVZXzrzr22FOWidq4d/8nAn0b4UzEMNW803B/5vQXZngy7zEgvNm5wdkAzgWQC02B7s6j3y90sUIAxPTPP0mvrKemNP/Sz2/4K9rs8g=='

describe('Sui golden vectors', () => {
  it("derives the expected Sui address from mnemonic + path (m/44'/784')", async () => {
    const account = await WalletAccountSui.at(TEST_MNEMONIC, TEST_PATH, {})
    assert.equal(await account.getAddress(), GOLDEN_SUI_ADDRESS)
  })

  it('sign matches golden signature (Ed25519, deterministic, offline)', async () => {
    const account = await WalletAccountSui.at(TEST_MNEMONIC, TEST_PATH, {})
    assert.equal(await account.sign(TEST_MESSAGE), GOLDEN_SUI_SIGNATURE)
  })
})
