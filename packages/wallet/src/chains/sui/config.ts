import type { SuiWalletConfig } from '#vendor/sui/wallet-account-read-only-sui.js'

import type { SuiGasStation } from './sponsored-transaction.js'

export type { SuiWalletConfig }

// The four @mysten/sui v2 network identifiers. Callers pass this IN (from their own config);
// the wallet never reads it from the environment.
export type SuiNetwork = 'mainnet' | 'testnet' | 'devnet' | 'localnet'

export type SuiGasCoinRef = {
  objectId: string
  version: string
  digest: string
}

export type LiveStreakSuiWalletConfig = SuiWalletConfig & {
  isSponsored?: boolean
  gasStation?: SuiGasStation
  // Which Sui network the rpcUrl targets. Flows in from the owning package's config; defaults to
  // 'localnet' when omitted so existing signatures stay compatible.
  network?: SuiNetwork
}

export function isSponsoredSuiConfig(
  config: LiveStreakSuiWalletConfig,
): config is LiveStreakSuiWalletConfig & { gasStation: SuiGasStation } {
  return config.gasStation !== undefined
}
