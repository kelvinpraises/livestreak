import { EVM_TEST_USDC } from "#/utils/deployments"
import { useState, useRef } from "react"
import type { Address } from 'viem'
import { useOptionsContext } from '#/providers/options-provider'
import type { OptionsChainKind } from '#/utils/chain'

export interface WalletActions {
  readonly address: Address | null
  readonly chain: OptionsChainKind
  readonly usdcBalance: number
  readonly isConnected: boolean
  readonly canTopUp: boolean
  readonly topUp: (amountUsd?: number) => Promise<void>
  readonly isToppingUp: boolean
}

/** Test USDC is requested directly from its configured Arbitrum Sepolia token. */
export function useWalletActions(): WalletActions {
  const { address, chain, usdcBalance, isConnected, mintTestUsdc } = useOptionsContext()
  const [isToppingUp, setToppingUp] = useState(false)
  const busy = useRef(false)
  return {
    address, chain, usdcBalance, isConnected,
    canTopUp: isConnected && chain === 'evm' && EVM_TEST_USDC !== undefined,
    isToppingUp,
    topUp: async (amountUsd = 100) => {
      if (busy.current) return
      busy.current = true; setToppingUp(true)
      try { await mintTestUsdc(amountUsd) }
      finally { busy.current = false; setToppingUp(false) }
    },
  }
}
