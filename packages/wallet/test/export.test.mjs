import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import createWalletManager, * as wallet from '@livestreak/wallet'

const EXPECTED_EXPORTS = [
  'createWalletManager',
  'default',
  'WalletManagerEvmErc4337',
  'WalletAccountEvmErc4337',
  'WalletAccountReadOnlyEvmErc4337',
  'WalletManagerSui',
  'WalletAccountSui',
  'WalletAccountReadOnlySui',
  'createSuiAccount',
  'assertGasStationReturnedTxMatchesKind',
  'ConfigurationError',
  'executeSponsoredTransaction',
  'assembleSponsoredTxBytes',
  'createLocalGasStation',
  'isSponsoredSuiConfig',
]

describe('public export surface', () => {
  it('exports the unified factory + per-chain classes + sponsored AA surface', () => {
    for (const name of EXPECTED_EXPORTS) {
      assert.ok(name in wallet, `missing export: ${name}`)
    }
  })

  it('default export is the createWalletManager factory', () => {
    assert.equal(createWalletManager, wallet.createWalletManager)
    assert.equal(typeof createWalletManager, 'function')
  })

  it('createWalletManager rejects an unknown chain with ConfigurationError', () => {
    assert.throws(
      () => createWalletManager('nope', 'seed', {}),
      (err) => err instanceof wallet.ConfigurationError,
    )
  })
})
