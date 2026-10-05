import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { WalletAccountEvmErc4337 } from '@livestreak/wallet'
import { PimlicoFeeEstimator, GenericFeeEstimator } from '@safe-global/relay-kit'

describe('fee estimator behind the Host proxy', () => {
  it('uses bundler fee support without requiring its name in the URL', async () => {
    const original = globalThis.fetch
    const account = Object.create(WalletAccountEvmErc4337.prototype)
    account._config = { bundlerUrl: 'https://host.example/aa/bundler/local', provider: 'https://rpc.example' }
    let calls = 0
    try {
      globalThis.fetch = async (url, options) => {
        calls++
        assert.equal(url, account._config.bundlerUrl)
        assert.equal(JSON.parse(options.body).method, 'pimlico_getUserOperationGasPrice')
        return { ok: true, json: async () => ({ result: { standard: { maxFeePerGas: '0x100', maxPriorityFeePerGas: '0x10' } } }) }
      }
      assert.ok(await account._getFeeEstimator() instanceof PimlicoFeeEstimator)
      assert.ok(await account._getFeeEstimator() instanceof PimlicoFeeEstimator)
      assert.equal(calls, 1)
    } finally { globalThis.fetch = original }
  })
  it('uses generic fees only when the bundler explicitly lacks the extension', async () => {
    const original = globalThis.fetch
    const account = Object.create(WalletAccountEvmErc4337.prototype)
    account._config = { bundlerUrl: 'https://host.example/aa/bundler/local', provider: 'https://rpc.example' }
    try {
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ error: { code: -32601 } }) })
      assert.ok(await account._getFeeEstimator() instanceof GenericFeeEstimator)
      account._feeEstimator = undefined
      globalThis.fetch = async () => ({ ok: false, status: 503 })
      await assert.rejects(account._getFeeEstimator(), /discovery failed/)
    } finally { globalThis.fetch = original }
  })
})

describe('sequential sponsored operations', () => {
  it('reads the pending EntryPoint nonce again after an included approval', async () => {
    const account = Object.create(WalletAccountEvmErc4337.prototype)
    account._config = { entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' }
    let reads = 0
    const provider = { request: async ({ method, params }) => {
      assert.equal(method, 'eth_call')
      assert.equal(params[0].to, account._config.entryPointAddress)
      assert.equal(params[1], 'pending')
      return reads++ === 0 ? '0x02' : '0x03'
    } }
    const pack = { protocolKit: { getSafeProvider: () => ({ getExternalProvider: () => provider }) } }
    const sender = '0x6A4401A97FEb566c2A8842eDcCa32f2d7d6d50c4'
    assert.equal(await account._getFreshNonce(pack, sender), 2n)
    assert.equal(await account._getFreshNonce(pack, sender), 3n)
    assert.equal(reads, 2)
  })
})

describe('confirmed receipt nonce floor', () => {
  it('advances a lagging RPC only after matching inclusion, including reverted execution', async () => {
    const account = Object.create(WalletAccountEvmErc4337.prototype)
    const sender = '0x6A4401A97FEb566c2A8842eDcCa32f2d7d6d50c4'
    account._config = { entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' }
    account._lastSubmittedOperation = { hash: '0xoperation', nonce: 2n }
    let receipt = null
    const pack = {
      protocolKit: { getSafeProvider: () => ({ getExternalProvider: () => ({ request: async () => '0x2' }) }) },
      getUserOperationReceipt: async hash => { assert.equal(hash, '0xoperation'); return receipt }
    }
    assert.equal(await account._getFreshNonce(pack, sender), 2n)
    receipt = { sender, nonce: '0x2', success: false, receipt: { blockHash: '0xblock' } }
    assert.equal(await account._getFreshNonce(pack, sender), 3n)
    receipt.sender = '0x0000000000000000000000000000000000000001'
    assert.equal(await account._getFreshNonce(pack, sender), 2n)
  })
})
