import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'

import WalletAccountReadOnlyEvmErc4337 from '../../src/vendor/evm-erc-4337/wallet-account-read-only-evm-erc-4337.js'
import WalletAccountEvmErc4337 from '../../src/vendor/evm-erc-4337/wallet-account-evm-erc-4337.js'
import { createOfflineMainnetProvider } from '../helpers/offline-mainnet-provider.mjs'

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const TEST_PATH = "0'/0/0"
const TEST_MESSAGE = 'livestreak-vector-v1'

export const GOLDEN_OWNER = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'
export const GOLDEN_SAFE_ADDRESS = '0xf099FaB27E67Eb3147960C0E23486E8A1a970C12'
export const GOLDEN_SIGNATURE =
  '0x0f6569c536c8196305be8bb78db804e70bce48e855300c257caf8e44c76423025197371d0bbb483e3368ddaa0873aac5811e9db77524f31d880dd317de66c4351c'

describe('EVM golden vectors', () => {
  it('derives the expected owner EOA from mnemonic + path', () => {
    const ownerAccount = new WalletAccountEvm(TEST_MNEMONIC, TEST_PATH, {})
    assert.equal(ownerAccount._address, GOLDEN_OWNER)
  })

  it('predictSafeAddress matches golden Safe address (chainId 1, offline fixture RPC)', async () => {
    const safeAddress = await WalletAccountReadOnlyEvmErc4337.predictSafeAddress(
      GOLDEN_OWNER,
      {
        chainId: 1,
        safeModulesVersion: '0.3.0',
        provider: createOfflineMainnetProvider(),
      },
    )
    assert.equal(safeAddress, GOLDEN_SAFE_ADDRESS)
  })

  it('sign matches golden signature (offline)', async () => {
    const account = new WalletAccountEvmErc4337(TEST_MNEMONIC, TEST_PATH, {})
    const signature = await account.sign(TEST_MESSAGE)
    assert.equal(signature, GOLDEN_SIGNATURE)
  })
})
