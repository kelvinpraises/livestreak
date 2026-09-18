import WalletManager, { type FeeRates } from '@tetherto/wdk-wallet'

import VendorWalletManagerSolana from '#vendor/solana/wallet-manager-solana.js'

import { WalletAccountSolana, WalletAccountSolanaGasless } from './account.js'
import {
  assertSolanaSponsorshipConfig,
  isSponsoredSolanaConfig,
  type LiveStreakSolanaWalletConfig,
} from './config.js'

export type SolanaWalletAccount = WalletAccountSolana | WalletAccountSolanaGasless

// One manager, config decides the account flavor (the EVM kit's isSponsored-union spirit):
// a paymaster config yields gasless accounts (Kora co-signs as fee payer), otherwise self-pay.
// Extends the WDK abstract directly — the two vendor account classes don't share a base past it,
// so this is the only shape that types both flavors honestly.
export default class WalletManagerSolana extends WalletManager {
  declare _config: LiveStreakSolanaWalletConfig
  // Vendor manager reused for rpc construction + fee rates; shares this manager's seed buffer.
  private readonly _rpcDelegate: VendorWalletManagerSolana

  constructor(seed: string | Uint8Array, config: LiveStreakSolanaWalletConfig = {}) {
    assertSolanaSponsorshipConfig(config)
    super(seed, config)
    this._rpcDelegate = new VendorWalletManagerSolana(this.seed, config)
  }

  override async getAccount(index = 0): Promise<SolanaWalletAccount> {
    return this.getAccountByPath(`${index}'/0'`)
  }

  override async getAccountByPath(path: string): Promise<SolanaWalletAccount> {
    if (!this._accounts[path]) {
      this._accounts[path] = isSponsoredSolanaConfig(this._config)
        ? new WalletAccountSolanaGasless(this.seed, path, this._config)
        : new WalletAccountSolana(this.seed, path, this._config)
    }
    return this._accounts[path] as SolanaWalletAccount
  }

  override async getFeeRates(): Promise<FeeRates> {
    return this._rpcDelegate.getFeeRates()
  }
}
