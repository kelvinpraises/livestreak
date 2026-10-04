import { createContext, useContext, type ReactNode } from 'react'
import type { WalletState } from '#/types/ui'
import { useOptionsContext } from '#/providers/options-provider'
import type { Address } from 'viem'
interface WalletContextValue {
  address: Address | null
  isConnected: boolean
  isLoading: boolean
  error: string | null
  usdcBalance: bigint
  connect: (password: string) => Promise<void>
  disconnect: () => void
  legacyWallet: WalletState
}
const WalletContext = createContext<WalletContextValue | null>(null)
export function WalletProvider({ children }: { children: ReactNode }) {
  const options = useOptionsContext()
  const connected = options.enabled && options.isConnected
  const value: WalletContextValue = {
    address: connected ? options.address : null,
    isConnected: connected,
    isLoading: options.isLoading,
    error: options.error,
    usdcBalance: connected ? BigInt(Math.round(options.usdcBalance * 1_000_000)) : 0n,
    connect: options.connect,
    disconnect: options.disconnect,
    legacyWallet: { address: connected && options.address ? `${options.address.slice(0, 6)}...${options.address.slice(-4)}` : '', usdcBalance: connected ? options.usdcBalance : 0, connected, sessionKeySigned: connected },
  }
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}
export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWalletContext must be used within <WalletProvider>')
  return ctx
}
