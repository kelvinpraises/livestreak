import { ConfigurationError, WalletManagerEvmErc4337 } from '#chains/evm.js'
import { WalletManagerSui } from '#chains/sui.js'

import type { WalletChain, WalletConfigByChain, WalletManagerForChain } from '#types.js'

export function createWalletManager<C extends WalletChain>(
  chain: C,
  seed: string | Uint8Array,
  config: WalletConfigByChain[C],
): WalletManagerForChain<C> {
  switch (chain) {
    case 'evm': {
      return new WalletManagerEvmErc4337(
        seed,
        config as WalletConfigByChain['evm'],
      ) as WalletManagerForChain<C>
    }
    case 'sui': {
      return new WalletManagerSui(
        seed,
        config as WalletConfigByChain['sui'],
      ) as WalletManagerForChain<C>
    }
    default: {
      throw new ConfigurationError(`Unsupported wallet chain: ${String(chain)}`)
    }
  }
}

export default createWalletManager
