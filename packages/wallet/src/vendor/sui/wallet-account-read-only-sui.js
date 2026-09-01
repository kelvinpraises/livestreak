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

import { WalletAccountReadOnly } from '@tetherto/wdk-wallet'
import FailoverProvider from '@tetherto/wdk-failover-provider'
import { SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { verifyPersonalMessageSignature } from '@mysten/sui/verify'
import { SUI_TYPE_ARG } from '@mysten/sui/utils'

/** @typedef {import('@mysten/sui/client').SuiClient} SuiClientType */
/** @typedef {import('@mysten/sui/client').SuiTransactionBlockResponse} SuiTransactionReceipt */
/** @typedef {import('@tetherto/wdk-wallet').TransactionResult} TransactionResult */
/** @typedef {import('@tetherto/wdk-wallet').TransferOptions} TransferOptions */
/** @typedef {import('@tetherto/wdk-wallet').TransferResult} TransferResult */

/**
 * @typedef {Object} SimpleSuiTransaction
 * @property {string} to - The recipient's SUI address.
 * @property {number | bigint} value - The amount of SUI to send in MIST (1 SUI = 1,000,000,000 MIST).
 */

/**
 * @typedef {SimpleSuiTransaction | Transaction} SuiTransaction
 */

/**
 * @typedef {Object} SuiWalletConfig
 * @property {string | string[]} [rpcUrl] - The SUI RPC endpoint(s).
 * @property {SuiClientType} [provider] - A pre-configured SUI client.
 * @property {number} [retries] - The number of retries for RPC requests (default: 3).
 * @property {number | bigint} [transferMaxFee] - Maximum allowed fee in MIST for transfer operations.
 */

/**
 * Read-only SUI wallet account implementation.
 */
export default class WalletAccountReadOnlySui extends WalletAccountReadOnly {
  /**
   * Creates a new SUI read-only wallet account.
   *
   * @param {string} addr - The account's address.
   * @param {Omit<SuiWalletConfig, 'transferMaxFee'>} [config] - The configuration object.
   */
  constructor (addr, config = {}) {
    super(addr)

    /**
     * The read-only wallet account configuration.
     *
     * @protected
     * @type {Omit<SuiWalletConfig, 'transferMaxFee'>}
     */
    this._config = config

    const { provider: providerOption, rpcUrl, retries = 3 } = config
    const rpcTarget = providerOption ?? rpcUrl

    /**
     * A SUI client for RPC requests.
     *
     * @protected
     * @type {SuiClientType | undefined}
     */
    this._client = undefined

    if (Array.isArray(rpcTarget)) {
      if (rpcTarget.length > 0) {
        const failoverProvider = new FailoverProvider({ retries })
        for (const entry of rpcTarget) {
          const client = new SuiClient({ url: entry })
          failoverProvider.addProvider(client)
        }
        this._client = failoverProvider.initialize()
      }
    } else if (typeof rpcTarget === 'string') {
      this._client = new SuiClient({ url: rpcTarget })
    } else if (rpcTarget) {
      this._client = rpcTarget
    }
  }

  /**
   * Returns the account's native SUI balance.
   *
   * @returns {Promise<bigint>} The SUI balance (in MIST).
   */
  async getBalance () {
    if (!this._client) {
      throw new Error('The wallet must be connected to a provider to retrieve balances.')
    }

    const addr = await this.getAddress()
    const balance = await this._client.getBalance({
      owner: addr,
      coinType: SUI_TYPE_ARG
    })

    return BigInt(balance.totalBalance)
  }

  /**
   * Returns the account balance for a specific SUI coin.
   *
   * @param {string} coinType - The type of the coin (e.g., '0x2::sui::SUI' or other).
   * @returns {Promise<bigint>} The coin balance (in base unit).
   */
  async getTokenBalance (coinType) {
    if (!this._client) {
      throw new Error('The wallet must be connected to a provider to retrieve token balances.')
    }

    const addr = await this.getAddress()
    const balance = await this._client.getBalance({
      owner: addr,
      coinType
    })

    return BigInt(balance.totalBalance)
  }

  /**
   * Returns the account balances for multiple coins.
   *
   * @param {string[]} coinTypes - The types of the coins.
   * @returns {Promise<Record<string, bigint>>} A mapping of coin types to their balances (in base units).
   */
  async getTokenBalances (coinTypes) {
    if (!this._client) {
      throw new Error('The wallet must be connected to a provider to retrieve token balances.')
    }

    if (coinTypes.length === 0) {
      return {}
    }

    const addr = await this.getAddress()
    const results = await Promise.all(
      coinTypes.map(coinType => this._client.getBalance({ owner: addr, coinType }))
    )

    return coinTypes.reduce((acc, coinType, index) => {
      acc[coinType] = BigInt(results[index].totalBalance)
      return acc
    }, {})
  }

  /**
   * Returns the metadata for a specific coin type.
   *
   * @param {string} coinType - The type of the coin.
   * @returns {Promise<import('@mysten/sui/client').CoinMetadata | null>} The coin metadata.
   */
  async getTokenMetadata (coinType) {
    if (!this._client) {
      throw new Error('The wallet must be connected to a provider to retrieve token metadata.')
    }

    return await this._client.getCoinMetadata({ coinType })
  }

  /**
   * Quotes the costs of a send transaction operation.
   *
   * @param {SuiTransaction} tx - The transaction.
   * @returns {Promise<Omit<TransactionResult, 'hash'>>} The transaction's quotes.
   */
  async quoteSendTransaction (tx) {
    if (!this._client) {
      throw new Error('The wallet must be connected to a provider to quote transactions.')
    }

    const fee = await this._getTransactionFee(tx)
    return { fee }
  }

  /**
   * Quotes the costs of a transfer operation.
   *
   * @param {TransferOptions} options - The transfer's options.
   * @returns {Promise<Omit<TransferResult, 'hash'>>} The transfer's quotes.
   */
  async quoteTransfer (options) {
    if (!this._client) {
      throw new Error('The wallet must be connected to a provider to quote transfer operations.')
    }

    const { token, recipient, amount } = options
    const tx = await this._buildCoinTransferTransaction(token, recipient, amount)
    const fee = await this._getTransactionFee(tx)

    return { fee }
  }

  /**
   * Retrieves a transaction receipt by its digest.
   *
   * @param {string} hash - The transaction's digest.
   * @returns {Promise<SuiTransactionReceipt | null>} The receipt, or null if not found.
   */
  async getTransactionReceipt (hash) {
    if (!this._client) {
      throw new Error('The wallet must be connected to a provider to fetch transaction receipts.')
    }

    try {
      const transaction = await this._client.getTransactionBlock({
        digest: hash,
        options: {
          showEffects: true,
          showInput: true,
          showEvents: true,
          showObjectChanges: true,
          showBalanceChanges: true
        }
      })
      return transaction
    } catch (err) {
      return null
    }
  }

  /**
   * Verifies the message's signature.
   *
   * @param {string} message - The original message.
   * @param {string} signature - The signature to verify (serialized).
   * @returns {Promise<boolean>} True if the signature is valid.
   */
  async verify (message, signature) {
    const messageBytes = new TextEncoder().encode(message)
    const addr = await this.getAddress()

    try {
      const publicKey = await verifyPersonalMessageSignature(messageBytes, signature)
      return publicKey.toSuiAddress() === addr
    } catch (err) {
      return false
    }
  }

  /**
   * Calculates the fee for a given transaction.
   *
   * @protected
   * @param {SuiTransaction} tx - The transaction.
   * @returns {Promise<bigint>} The calculated transaction fee in MIST.
   */
  async _getTransactionFee (tx) {
    let transaction = tx

    if (tx.to !== undefined && tx.value !== undefined) {
      transaction = await this._buildNativeTransferTransaction(tx.to, tx.value)
    }

    if (!(transaction instanceof Transaction)) {
      throw new Error('Invalid transaction object.')
    }

    const addr = await this.getAddress()
    transaction.setSender(addr)

    const dryRun = await this._client.dryRunTransactionBlock({
      transactionBlock: await transaction.build({ client: this._client })
    })

    if (dryRun.effects.status.status === 'failure') {
      throw new Error(`Transaction simulation failed: ${dryRun.effects.status.error}`)
    }

    const gasUsed = dryRun.effects.gasUsed
    const fee = BigInt(gasUsed.computationCost) + BigInt(gasUsed.storageCost) - BigInt(gasUsed.storageRebate)

    return fee > 0n ? fee : 0n
  }

  /**
   * Builds a transaction for native SUI transfer.
   *
   * @protected
   * @param {string} to - The recipient's address.
   * @param {number | bigint} value - The amount of SUI to send (in MIST).
   * @returns {Promise<Transaction>} The constructed transaction.
   */
  async _buildNativeTransferTransaction (to, value) {
    const tx = new Transaction()
    const [coin] = tx.splitCoins(tx.gas, [value])
    tx.transferObjects([coin], to)
    return tx
  }

  /**
   * Builds a transaction for coin transfer.
   *
   * @protected
   * @param {string} coinType - The type of the coin.
   * @param {string} recipient - The recipient's address.
   * @param {number | bigint} amount - The amount to transfer.
   * @returns {Promise<Transaction>} The constructed transaction.
   */
  async _buildCoinTransferTransaction (coinType, recipient, amount) {
    if (coinType === SUI_TYPE_ARG) {
      return this._buildNativeTransferTransaction(recipient, amount)
    }

    if (!this._client) {
      throw new Error('The wallet must be connected to a provider to build transfer transactions.')
    }

    const tx = new Transaction()
    const addr = await this.getAddress()
    tx.setSender(addr)

    const { data: coins } = await this._client.getCoins({
      owner: addr,
      coinType
    })

    if (coins.length === 0) {
      throw new Error(`No coins found for type ${coinType}`)
    }

    const totalBalance = coins.reduce((sum, c) => sum + BigInt(c.balance), 0n)
    if (totalBalance < BigInt(amount)) {
      throw new Error(`Insufficient balance for ${coinType}. Required: ${amount}, Available: ${totalBalance}`)
    }

    coins.sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)))

    const coinsToUse = []
    let currentBalance = 0n
    for (const coin of coins) {
      coinsToUse.push(coin.coinObjectId)
      currentBalance += BigInt(coin.balance)
      if (currentBalance >= BigInt(amount)) break
    }

    const [primaryCoin, ...otherCoins] = coinsToUse.map(id => tx.object(id))
    if (otherCoins.length > 0) {
      tx.mergeCoins(primaryCoin, otherCoins)
    }

    const [splitCoin] = tx.splitCoins(primaryCoin, [amount])
    tx.transferObjects([splitCoin], recipient)

    return tx
  }
}
