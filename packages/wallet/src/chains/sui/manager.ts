import VendorWalletManagerSui from '#vendor/sui/wallet-manager-sui.js'

import { patchSuiAccountSend, type WalletAccountSui } from './account.js'
import type { LiveStreakSuiWalletConfig } from './config.js'

export default class WalletManagerSui extends VendorWalletManagerSui {
  declare _config: LiveStreakSuiWalletConfig

  override async getAccountByPath(path: string): Promise<WalletAccountSui> {
    const account = await super.getAccountByPath(path)
    return patchSuiAccountSend(account, this._config)
  }
}
