// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import HDKey from 'micro-key-producer/slip10.js'
import * as bip39 from 'bip39'

// eslint-disable-next-line camelcase
import { sodium_memzero } from 'sodium-universal'

import WalletAccountReadOnlySui from './wallet-account-read-only-sui.js'

/** @typedef {import('@tetherto/wdk-wallet').KeyPair} KeyPair */
/** @typedef {import('@tetherto/wdk-wallet').TransactionResult} TransactionResult */
/** @typedef {import('@tetherto/wdk-wallet').TransferOptions} TransferOptions */
/** @typedef {import('@tetherto/wdk-wallet').TransferResult} TransferResult */

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */

/** @typedef {import('./wallet-account-read-only-sui.js').SuiTransaction} SuiTransaction */
/** @typedef {import('./wallet-account-read-only-sui.js').SuiWalletConfig} SuiWalletConfig */

const SLIP_0010_SUI_DERIVATION_PATH_PREFIX = "m/44'/784'"

/**
 * Full-featured SUI wallet account implementation with signing capabilities.
 *
 * @implements {IWalletAccount}
 */
export default class WalletAccountSui extends WalletAccountReadOnlySui {
  /**
   * @private
   * Use {@link WalletAccountSui.at} instead.
   */
  constructor (seed, path, config = {}) {
    if (typeof seed === 'string') {
      if (!bip39.validateMnemonic(seed)) {
        throw new Error('The seed phrase is invalid.')
      }
      seed = bip39.mnemonicToSeedSync(seed)
    }

    super(undefined, config)

    /**
     * @private
     */
    this._seed = seed

    /**
     * @private
     */
    this._path = `${SLIP_0010_SUI_DERIVATION_PATH_PREFIX}/${path}`

    /**
     * The Ed25519 key pair for signing.
     *
     * @private
     * @type {Ed25519Keypair | undefined}
     */
    this._keypair = undefined

    /**
     * Raw Ed25519 public key bytes.
     *
     * @private
     * @type {Uint8Array | undefined}
     */
    this._rawPublicKey = undefined

    /**
     * Raw Ed25519 private key bytes.
     *
     * @private
     * @type {Uint8Array | undefined}
     */
    this._rawPrivateKey = undefined
  }

  /**
   * Creates a new SUI wallet account.
   *
   * @param {string | Uint8Array} seed - The wallet's BIP-39 seed phrase.
   * @param {string} path - The SLIP-0010 derivation path (e.g. "0'/0'/0'").
   * @param {SuiWalletConfig} [config] - The configuration object.
   * @returns {Promise<WalletAccountSui>} The wallet account.
   */
  static async at (seed, path, config = {}) {
    const account = new WalletAccountSui(seed, path, config)

    const hdKey = HDKey.fromMasterSeed(account._seed)
    const { privateKey } = hdKey.derive(account._path, true)

    account._keypair = Ed25519Keypair.fromSecretKey(privateKey)
    account._rawPublicKey = account._keypair.getPublicKey().toRawBytes()
    account._rawPrivateKey = new Uint8Array(privateKey)

    sodium_memzero(privateKey)

    return account
  }

  /**
   * The derivation path's index of this account.
   *
   * @type {number}
   */
  get index () {
    const segments = this._path.split('/')
    return +segments[3].replace("'", '')
  }

  /**
   * The derivation path of this account.
   *
   * @type {string}
   */
  get path () {
    return this._path
  }

  /**
   * The account's key pair.
   *
   * @type {KeyPair}
   */
  get keyPair () {
    return {
      privateKey: this._rawPrivateKey,
      publicKey: this._rawPublicKey
    }
  }

  /**
   * The address of this account.
   *
   * @returns {Promise<string>} The address.
   */
  async getAddress () {
    return this._keypair.getPublicKey().toSuiAddress()
  }

  /**
   * Signs a message.
   *
   * @param {string} message - The message to sign.
   * @returns {Promise<string>} The message's signature (serialized).
   */
  async sign (message) {
    if (!this._keypair) {
      throw new Error('The wallet account has been disposed.')
    }
    const messageBytes = new TextEncoder().encode(message)
    const { signature } = await this._keypair.signPersonalMessage(messageBytes)
    return signature
  }

  /**
   * Signs a transaction.
   *
   * @param {SuiTransaction} tx - The transaction to sign.
   * @returns {Promise<string>} The signed transaction (serialized signature).
   */
  async signTransaction (tx) {
    if (!this._keypair) {
      throw new Error('The wallet account has been disposed.')
    }

    let transaction = tx
    if (tx.to !== undefined && tx.value !== undefined) {
      transaction = await this._buildNativeTransferTransaction(tx.to, tx.value)
    }

    if (!(transaction instanceof Transaction)) {
      throw new Error('Invalid transaction object.')
    }

    transaction.setSender(await this.getAddress())
    const { signature } = await this._keypair.signTransaction(await transaction.build({ client: this._client }))

    return signature
  }

  /**
   * Sends a transaction.
   *
   * @param {SuiTransaction} tx - The transaction.
   * @returns {Promise<TransactionResult>} The transaction's result.
   */
  async sendTransaction (tx) {
    if (!this._keypair) {
      throw new Error('The wallet account has been disposed.')
    }

    if (!this._client) {
      throw new Error('The wallet must be connected to a provider to send transactions.')
    }

    let transaction = tx
    if (tx.to !== undefined && tx.value !== undefined) {
      transaction = await this._buildNativeTransferTransaction(tx.to, tx.value)
    }

    const fee = await this._getTransactionFee(transaction)

    if (this._config.transferMaxFee !== undefined && fee >= this._config.transferMaxFee) {
      throw new Error(`Exceeded maximum fee cost for transaction. Fee: ${fee}, Max: ${this._config.transferMaxFee}`)
    }

    const result = await this._client.signAndExecuteTransaction({
      signer: this._keypair,
      transaction,
      options: {
        showEffects: true
      }
    })

    const gasUsed = result.effects?.gasUsed
    const actualFee = gasUsed
      ? BigInt(gasUsed.computationCost) + BigInt(gasUsed.storageCost) - BigInt(gasUsed.storageRebate)
      : fee

    return {
      hash: result.digest,
      fee: actualFee
    }
  }

  /**
   * Transfers native SUI.
   *
   * @deprecated Use {@link sendTransaction} instead.
   * @param {string} to - Recipient address.
   * @param {number | bigint} amount - Amount in MIST.
   * @returns {Promise<TransactionResult>}
   */
  async send (to, amount) {
    if (!to || typeof to !== 'string' || !to.startsWith('0x')) {
      throw new Error('Invalid recipient address.')
    }
    if (BigInt(amount) <= 0n) {
      throw new Error('Amount must be greater than 0.')
    }
    return this.sendTransaction({ to, value: amount })
  }

  /**
   * Transfers a token (coin) to another address.
   *
   * @param {TransferOptions} options - The transfer's options.
   * @returns {Promise<TransferResult>} The transfer's result.
   */
  async transfer (options) {
    if (!this._keypair) {
      throw new Error('The wallet account has been disposed.')
    }

    const { token, recipient, amount } = options

    if (!token || typeof token !== 'string') {
      throw new Error('Invalid token (coin) type.')
    }
    if (!recipient || typeof recipient !== 'string') {
      throw new Error('Invalid recipient address.')
    }
    if (BigInt(amount) <= 0n) {
      throw new Error('Amount must be greater than 0.')
    }

    const transaction = await this._buildCoinTransferTransaction(token, recipient, amount)

    const { hash, fee } = await this.sendTransaction(transaction)

    return { hash, fee }
  }

  /**
   * Publishes a Move package.
   *
   * @param {Object} options - Publish options.
   * @param {string[]} options.modules - Compiled modules as base64 strings.
   * @param {string[]} options.dependencies - Dependencies of the package.
   * @returns {Promise<TransactionResult>}
   */
  async publish (options) {
    if (!this._keypair) {
      throw new Error('The wallet account has been disposed.')
    }

    const tx = new Transaction()
    const [upgradeCap] = tx.publish({
      modules: options.modules,
      dependencies: options.dependencies
    })
    tx.transferObjects([upgradeCap], await this.getAddress())

    return this.sendTransaction(tx)
  }

  /**
   * Executes a Move call.
   *
   * @param {Object} options - Move call options.
   * @param {string} options.target - The target function (e.g. "package::module::function").
   * @param {string[]} [options.typeArguments] - Type arguments for the function.
   * @param {any[]} [options.arguments] - Arguments for the function.
   * @returns {Promise<TransactionResult>}
   */
  async moveCall (options) {
    if (!this._keypair) {
      throw new Error('The wallet account has been disposed.')
    }

    const tx = new Transaction()
    tx.moveCall({
      target: options.target,
      typeArguments: options.typeArguments || [],
      arguments: options.arguments?.map(arg => {
        if (typeof arg === 'string' && arg.startsWith('0x')) return tx.object(arg)
        return tx.pure(arg)
      }) || []
    })

    return this.sendTransaction(tx)
  }

  /**
   * Returns a read-only copy of the account.

   *
   * @returns {Promise<WalletAccountReadOnlySui>} The read-only account.
   */
  async toReadOnlyAccount () {
    if (!this._suiReadOnlyAccount) {
      const address = await this.getAddress()
      this._suiReadOnlyAccount = new WalletAccountReadOnlySui(address, this._config)
    }

    return this._suiReadOnlyAccount
  }

  /**
   * Disposes the wallet account, erasing the private key from memory.
   */
  dispose () {
    if (this._rawPrivateKey) {
      sodium_memzero(this._rawPrivateKey)
    }
    this._rawPrivateKey = undefined
    this._rawPublicKey = undefined
    this._keypair = undefined
    this._seed = undefined
  }
}
