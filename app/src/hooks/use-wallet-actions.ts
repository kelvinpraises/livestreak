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

/** Host does not issue stablecoins. Obtain test USDG from Paxos, then refresh the wallet. */
export function useWalletActions(): WalletActions {
  const { address, chain, usdcBalance, isConnected } = useOptionsContext()
  return {
    address, chain, usdcBalance, isConnected,
    canTopUp: false,
    isToppingUp: false,
    topUp: async () => {
      throw new Error('Obtain test USDG from the Paxos testnet faucet.')
    },
  }
}
