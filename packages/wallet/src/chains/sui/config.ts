import type { SuiWalletConfig } from '#vendor/sui/wallet-account-read-only-sui.js'

import type { SuiGasStation } from './sponsored-transaction.js'

export type { SuiWalletConfig }

export type SuiGasCoinRef = {
  objectId: string
  version: string
  digest: string
}

export type LiveStreakSuiWalletConfig = SuiWalletConfig & {
  isSponsored?: boolean
  gasStation?: SuiGasStation
}

export function isSponsoredSuiConfig(
  config: LiveStreakSuiWalletConfig,
): config is LiveStreakSuiWalletConfig & { gasStation: SuiGasStation } {
  return config.gasStation !== undefined
}
