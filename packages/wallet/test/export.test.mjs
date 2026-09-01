import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Imports the BUILT public surface (dist) via the package's own exports map —
// `npm test` builds first (pretest), so this verifies what consumers actually get.
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
  'ConfigurationError',
]

describe('public export surface', () => {
  it('exports the unified factory + every per-chain class + ConfigurationError', () => {
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
