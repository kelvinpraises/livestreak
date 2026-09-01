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

import WalletManager from '@tetherto/wdk-wallet'
import FailoverProvider from '@tetherto/wdk-failover-provider'
import { SuiClient } from '@mysten/sui/client'
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet'

import WalletAccountSui from './wallet-account-sui.js'

/** @typedef {import('@mysten/sui/client').SuiClient} SuiClientType */
/** @typedef {import('@tetherto/wdk-wallet').FeeRates} FeeRates */

/**
 * @typedef {Object} SuiWalletConfig
 * @property {string | string[]} [rpcUrl] - The SUI RPC endpoint(s).
 * @property {SuiClientType} [provider] - A pre-configured SUI client.
 * @property {number} [retries] - The number of retries for RPC requests (default: 3).
 */

export default class WalletManagerSui extends WalletManager {
  /**
   * Creates a new wallet manager for the SUI blockchain.
   *
   * @param {string | Uint8Array} seed - The wallet's [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) seed phrase.
   * @param {SuiWalletConfig} [config] - The configuration object.
   */
  constructor (seed, config = {}) {
    super(seed, config)

    /**
     * The SUI wallet configuration.
     *
     * @protected
     * @type {SuiWalletConfig}
     */
    this._config = config

    const { provider: providerOption, rpcUrl, retries = 3 } = config

    // Use recommended RPC if none provided
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

    /**
     * @protected
     * @type {boolean}
     */
    this._disposed = false
  }

  /**
   * Returns the wallet account at a specific index.
   *
   * @example
   * // Returns the account with derivation path m/44'/784'/index'/0'/0'
   * const account = await wallet.getAccount(1);
   * @param {number} [index] - The index of the account to get (default: 0).
   * @returns {Promise<WalletAccountSui>} The account.
   */
  async getAccount (index = 0) {
    return await this.getAccountByPath(`${index}'/0'/0'`)
  }

  /**
   * Returns the wallet account at a specific derivation path.
   *
   * @example
   * // Returns the account with derivation path m/44'/784'/0'/0'/1'
   * const account = await wallet.getAccountByPath("0'/0'/1'");
   * @param {string} path - The derivation path (e.g. "0'/0'/0'").
   * @returns {Promise<WalletAccountSui>} The account.
   */
  async getAccountByPath (path) {
    if (this._disposed) {
      throw new Error('The wallet has been disposed.')
    }
    if (!this._accounts[path]) {
      const account = await WalletAccountSui.at(this.seed, path, this._config)
      this._accounts[path] = account
    }

    return this._accounts[path]
  }

  /**
   * Requests SUI from the faucet for a specific account.
   *
   * @param {number} [index] - The index of the account (default: 0).
   * @param {'testnet' | 'devnet'} [network] - The network to request SUI from (default: 'testnet').
   * @returns {Promise<void>}
   */
  async requestFaucet (index = 0, network = 'testnet') {
    if (network !== 'testnet' && network !== 'devnet') {
      throw new Error('Faucet is only available on testnet or devnet.')
    }

    const account = await this.getAccount(index)
    const address = await account.getAddress()

    await requestSuiFromFaucetV2({
      host: getFaucetHost(network),
      recipient: address
    })
  }

  /**
   * Returns the current fee rates.
   *
   * @returns {Promise<FeeRates>} The fee rates (in MIST).
   */
  async getFeeRates () {
    if (!this._client) {
      throw new Error('The wallet must be connected to a provider to get fee rates.')
    }

    const gasPrice = await this._client.getReferenceGasPrice()
    const fee = BigInt(gasPrice)

    // Using same multipliers as Solana for consistency if applicable,
    // or standard SUI buffers.
    return {
      normal: fee,
      fast: (fee * 120n) / 100n
    }
  }

  /**
   * Securely disposes of the wallet and all its accounts.
   */
  dispose () {
    this._disposed = true
    for (const path in this._accounts) {
      this._accounts[path].dispose()
    }
    super.dispose()
  }
}
