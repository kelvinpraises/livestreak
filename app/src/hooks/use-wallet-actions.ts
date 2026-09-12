import { useCallback, useState } from 'react'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseUnits,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { useOptionsContext } from '#/providers/options-provider'
import { LOCAL_CHAIN_ID } from '#/utils/env'
import { LOCALHOST_MOCK_USDC, LOCALHOST_RPC_URL } from '#/utils/deployments'

// The well-known Anvil dev account #0 — a PUBLIC test key, pre-funded with ETH on every localhost
// node. It only ever signs the permissionless MockUSDC.mint below. `import.meta.env.DEV` is statically
// `false` in production builds, so this constant and the whole faucet path are tree-shaken out of prod
// — a deployed app ships no faucet (mainnet users bring real USDC; there is no faucet to need).
const DEV_FAUCET_KEY = import.meta.env.DEV
  ? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  : undefined

// 6-decimal MockUSDC mint (matches the deployed mock — see test/mocks/MockUSDC.sol).
const MINT_ABI = [
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

const DEFAULT_TOP_UP_USD = 1_000_000

const isLoopbackRpc = (url: string): boolean =>
  /^https?:\/\/(127\.0\.0\.1|0\.0\.0\.0|localhost)(:|\/|$)/u.test(url)

const localChain = defineChain({
  id: LOCAL_CHAIN_ID,
  name: 'Localhost',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [LOCALHOST_RPC_URL] } },
})

export interface WalletActions {
  /** The connected Safe (smart-account) address that holds USDC + position NFTs. */
  readonly address: Address | null
  readonly chain: 'evm' | 'sui'
  readonly usdcBalance: number
  readonly isConnected: boolean
  /**
   * Dev faucet availability. True only on the local EVM dev stack with a connected wallet; false on
   * Sui, when disconnected, against a non-loopback RPC, or in ANY production build (no `DEV_FAUCET_KEY`).
   * The UI shows the top-up affordance only when this is true.
   */
  readonly canTopUp: boolean
  /** Mint `amountUsd` of test USDC straight to the connected Safe, then refresh the balance. */
  readonly topUp: (amountUsd?: number) => Promise<void>
  readonly isToppingUp: boolean
}

/**
 * Owns wallet-level actions on the connected Safe — distinct from the market/options actions in the
 * options context. Today that's the dev top-up (so a demo wallet can self-fund without hand-minting
 * over the CLI); the betting actions stay on the options context. On mainnet `canTopUp` is false and
 * topUp throws — funding there is a real USDC deposit, out of this faucet's scope.
 */
export function useWalletActions(): WalletActions {
  const { address, chain, usdcBalance, isConnected, refresh } = useOptionsContext()
  const [isToppingUp, setIsToppingUp] = useState(false)

  const canTopUp =
    DEV_FAUCET_KEY !== undefined &&
    chain === 'evm' &&
    isConnected &&
    address !== null &&
    LOCALHOST_MOCK_USDC !== undefined &&
    isLoopbackRpc(LOCALHOST_RPC_URL)

  const topUp = useCallback(
    async (amountUsd: number = DEFAULT_TOP_UP_USD): Promise<void> => {
      if (
        DEV_FAUCET_KEY === undefined ||
        chain !== 'evm' ||
        !address ||
        LOCALHOST_MOCK_USDC === undefined ||
        !isLoopbackRpc(LOCALHOST_RPC_URL)
      ) {
        throw new Error('Top up is only available on the local EVM dev stack')
      }
      setIsToppingUp(true)
      try {
        const walletClient = createWalletClient({
          account: privateKeyToAccount(DEV_FAUCET_KEY),
          chain: localChain,
          transport: http(LOCALHOST_RPC_URL),
        })
        const hash = await walletClient.writeContract({
          address: LOCALHOST_MOCK_USDC,
          abi: MINT_ABI,
          functionName: 'mint',
          args: [getAddress(address), parseUnits(String(amountUsd), 6)],
        })
        // Wait for inclusion so the balance read after this reflects the mint.
        const publicClient = createPublicClient({ chain: localChain, transport: http(LOCALHOST_RPC_URL) })
        await publicClient.waitForTransactionReceipt({ hash })
        await refresh()
      } finally {
        setIsToppingUp(false)
      }
    },
    [address, chain, refresh],
  )

  return { address, chain, usdcBalance, isConnected, canTopUp, topUp, isToppingUp }
}
