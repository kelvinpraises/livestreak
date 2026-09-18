import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createNoopSigner, pipe } from '@solana/kit'
import { compileTransaction } from '@solana/transactions'
import {
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
} from '@solana/transaction-messages'
import { getTransferSolInstruction } from '@solana-program/system'

import {
  ConfigurationError,
  WalletAccountSolana,
  WalletAccountSolanaGasless,
  WalletManagerSolana,
  assertKoraPreservedSignedTransaction,
  createWalletManager,
  getBase64EncodedWireTransaction,
  guardKoraClient,
  isSponsoredSolanaConfig,
  pollUntilUserOperationIncluded,
  readSolanaSignatureReceipt,
  solanaAddress,
} from '@livestreak/wallet'

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
// Phantom-standard path m/44'/501'/0'/0' for the BIP-39 reference mnemonic.
const GOLDEN_SOLANA_ADDRESS = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk'
const GOLDEN_SIGNATURE =
  'd3d9285ca856d33682b3f12580ddc0e2483cf78a94af3a3debd8b481befa5723bf5e93319b9d84920a5b5352f5a52604dbca529b17d82a451c8c8ab884c09f09'

const PAYMASTER_ADDRESS = 'F7yEXcVsfa8pDMDWnbEmXqEQdSHYzsBSt7uHRj3nBGpo'
const SPONSORED_CONFIG = {
  provider: 'http://127.0.0.1:1',
  isSponsored: true,
  paymasterUrl: 'http://127.0.0.1:2',
  paymasterAddress: PAYMASTER_ADDRESS,
  paymasterToken: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
}

describe('Solana golden vectors', () => {
  it('derives the expected address from mnemonic at m/44\'/501\'/0\'/0\'', async () => {
    const manager = new WalletManagerSolana(TEST_MNEMONIC, {})
    const account = await manager.getAccount(0)
    assert.equal(await account.getAddress(), GOLDEN_SOLANA_ADDRESS)
    assert.equal(account.path, "m/44'/501'/0'/0'")
  })

  it('sign matches golden signature (offline)', async () => {
    const manager = new WalletManagerSolana(TEST_MNEMONIC, {})
    const account = await manager.getAccount(0)
    assert.equal(await account.sign('livestreak-vector-v1'), GOLDEN_SIGNATURE)
  })
})

describe('Solana config-union dispatch', () => {
  it('plain config yields a self-pay account', async () => {
    const manager = createWalletManager('solana', TEST_MNEMONIC, {})
    const account = await manager.getAccount()
    assert.ok(account instanceof WalletAccountSolana)
  })

  it('paymaster config yields a gasless account with the same address', async () => {
    const manager = createWalletManager('solana', TEST_MNEMONIC, SPONSORED_CONFIG)
    const account = await manager.getAccount()
    assert.ok(account instanceof WalletAccountSolanaGasless)
    assert.equal(await account.getAddress(), GOLDEN_SOLANA_ADDRESS)
  })

  it('isSponsored without the paymaster triple fails fast at construction', () => {
    assert.throws(
      () => createWalletManager('solana', TEST_MNEMONIC, { isSponsored: true }),
      (err) => err instanceof ConfigurationError,
    )
  })

  it('isSponsoredSolanaConfig discriminates on paymasterUrl', () => {
    assert.equal(isSponsoredSolanaConfig({}), false)
    assert.equal(isSponsoredSolanaConfig(SPONSORED_CONFIG), true)
  })
})

// A real compiled v0 message (offline blockhash) so the guard exercises the actual wire codec.
const buildWireFixture = () => {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(solanaAddress(PAYMASTER_ADDRESS), tx),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 0n },
        tx,
      ),
    (tx) =>
      appendTransactionMessageInstruction(
        getTransferSolInstruction({
          source: createNoopSigner(solanaAddress(GOLDEN_SOLANA_ADDRESS)),
          destination: solanaAddress(PAYMASTER_ADDRESS),
          amount: 1n,
        }),
        tx,
      ),
  )
  const compiled = compileTransaction(message)
  const senderSignature = new Uint8Array(64).fill(7)
  const sent = {
    ...compiled,
    signatures: { ...compiled.signatures, [GOLDEN_SOLANA_ADDRESS]: senderSignature },
  }
  return { sent, senderSignature }
}

describe('Kora integrity guard', () => {
  it('accepts a response that only fills the paymaster signature slot', () => {
    const { sent, senderSignature } = buildWireFixture()
    const returned = {
      ...sent,
      signatures: {
        ...sent.signatures,
        [PAYMASTER_ADDRESS]: new Uint8Array(64).fill(9),
        [GOLDEN_SOLANA_ADDRESS]: senderSignature,
      },
    }
    assertKoraPreservedSignedTransaction(
      getBase64EncodedWireTransaction(sent),
      getBase64EncodedWireTransaction(returned),
    )
  })

  it('rejects a response with an altered message', () => {
    const { sent } = buildWireFixture()
    const tamperedMessage = new Uint8Array(sent.messageBytes)
    tamperedMessage[tamperedMessage.length - 1] ^= 0xff
    const returned = { ...sent, messageBytes: tamperedMessage }
    assert.throws(
      () =>
        assertKoraPreservedSignedTransaction(
          getBase64EncodedWireTransaction(sent),
          getBase64EncodedWireTransaction(returned),
        ),
      /altered message/,
    )
  })

  it('rejects a response that replaces the sender signature', () => {
    const { sent } = buildWireFixture()
    const returned = {
      ...sent,
      signatures: {
        ...sent.signatures,
        [GOLDEN_SOLANA_ADDRESS]: new Uint8Array(64).fill(1),
      },
    }
    assert.throws(
      () =>
        assertKoraPreservedSignedTransaction(
          getBase64EncodedWireTransaction(sent),
          getBase64EncodedWireTransaction(returned),
        ),
      /dropped or replaced/,
    )
  })

  it('guardKoraClient intercepts signTransaction and passes other methods through', async () => {
    const { sent } = buildWireFixture()
    const sentWire = getBase64EncodedWireTransaction(sent)
    const tampered = {
      ...sent,
      signatures: { ...sent.signatures, [GOLDEN_SOLANA_ADDRESS]: new Uint8Array(64).fill(1) },
    }
    const client = {
      async signTransaction() {
        return { signed_transaction: getBase64EncodedWireTransaction(tampered) }
      },
      async getBlockhash() {
        return { blockhash: 'untouched' }
      },
    }
    const guarded = guardKoraClient(client)
    await assert.rejects(
      guarded.signTransaction({ transaction: sentWire }),
      /dropped or replaced/,
    )
    assert.deepEqual(await guarded.getBlockhash(), { blockhash: 'untouched' })
  })
})

describe('signature-status receipt shim', () => {
  const rpcWith = (status) => ({
    getSignatureStatuses: () => ({ send: async () => ({ value: [status] }) }),
  })

  it('maps pending to null, confirmed to success, err to failure', async () => {
    assert.equal(await readSolanaSignatureReceipt(rpcWith(null), 'sig'), null)
    assert.equal(
      await readSolanaSignatureReceipt(rpcWith({ confirmationStatus: 'processed', err: null }), 'sig'),
      null,
    )
    const ok = await readSolanaSignatureReceipt(
      rpcWith({ confirmationStatus: 'finalized', err: null }),
      'sig',
    )
    assert.equal(ok.success, true)
    const failed = await readSolanaSignatureReceipt(
      rpcWith({ confirmationStatus: 'confirmed', err: { InstructionError: [0, 'Custom'] } }),
      'sig',
    )
    assert.equal(failed.success, false)
  })

  it('feeds the shared poller unchanged', async () => {
    const readOnly = {
      async getUserOperationReceipt(hash) {
        return readSolanaSignatureReceipt(
          rpcWith({ confirmationStatus: 'confirmed', err: null }),
          hash,
        )
      },
    }
    const receipt = await pollUntilUserOperationIncluded(readOnly, 'sig', { timeoutMs: 1_000 })
    assert.equal(receipt.success, true)
  })
})
