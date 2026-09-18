import type {
  EvmErc4337WalletConfig,
  WalletManagerEvmErc4337,
} from '#chains/evm.js'
import type {
  LiveStreakSolanaWalletConfig,
  WalletManagerSolana,
} from '#chains/solana/index.js'
import type { SuiWalletConfig, WalletManagerSui } from '#chains/sui/index.js'

export type WalletChain = 'evm' | 'sui' | 'solana'

export type { EvmErc4337WalletConfig } from '#chains/evm.js'
export type { LiveStreakSolanaWalletConfig } from '#chains/solana/index.js'
export type { SuiWalletConfig } from '#chains/sui/index.js'
export type { WalletAccountSui } from '#chains/sui/account.js'

export type WalletConfigByChain = {
  evm: EvmErc4337WalletConfig
  sui: SuiWalletConfig
  solana: LiveStreakSolanaWalletConfig
}

export type WalletManagerForChain<C extends WalletChain> =
  C extends 'evm'
    ? WalletManagerEvmErc4337
    : C extends 'sui'
      ? WalletManagerSui
      : C extends 'solana'
        ? WalletManagerSolana
        : never
