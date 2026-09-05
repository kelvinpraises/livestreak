import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { WalletAccountEvmErc4337 } from '@livestreak/wallet'

// F2: dispose() must clear the cached Safe4337Pack instances (each may hold the owner signer hex).
// We invoke the real dispose() against a minimal instance carrying the two fields it touches, so the
// test exercises the actual method body without a full on-chain account construction.
describe('WalletAccountEvmErc4337.dispose() — F2 signer-pack cleanup', () => {
  it('clears _safe4337Packs (and disposes the owner) on dispose', () => {
    let ownerDisposed = false
    const account = Object.create(WalletAccountEvmErc4337.prototype)
    account._ownerAccount = { dispose: () => { ownerDisposed = true } }
    account._safe4337Packs = new Map([['cfg-a', { fake: 'pack' }], ['cfg-b', { fake: 'pack' }]])

    assert.equal(account._safe4337Packs.size, 2)
    account.dispose()
    assert.equal(ownerDisposed, true)
    assert.equal(account._safe4337Packs.size, 0)
  })
})
