import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useStealthWallet } from '#/hooks/useStealthWallet.ts'
import { mockWallet, type WalletState } from '#/data/mock.ts'
import { type Address } from 'viem'

/* ─── Context shape ─── */

interface WalletContextValue {
  // Smart wallet (@livestreak/wallet, password-derived ERC-4337 Safe)
  address: Address | null
  isConnected: boolean
  isLoading: boolean
  error: string | null
  usdcBalance: bigint
  connect: (password: string) => Promise<void>
  disconnect: () => void
  sendUserOperation: (calls: unknown[]) => Promise<string>
  // Legacy mock wallet (for components that still consume WalletState)
  legacyWallet: WalletState
}

const WalletContext = createContext<WalletContextValue | null>(null)

/* ─── Provider ─── */

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useStealthWallet()

  // Bridge live wallet state into the legacy WalletState format so
  // existing components (BalanceBar, etc.) keep working without changes.
  const legacyWallet: WalletState = useMemo(() => ({
    address: wallet.address
      ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
      : mockWallet.address,
    usdcBalance: wallet.isConnected
      ? Number(wallet.usdcBalance) / 1e6  // ERC-20 USDC is 6 decimals
      : mockWallet.usdcBalance,
    connected: wallet.isConnected,
    sessionKeySigned: wallet.isConnected,
  }), [wallet.address, wallet.isConnected, wallet.usdcBalance])

  const value: WalletContextValue = useMemo(() => ({
    address: wallet.address,
    isConnected: wallet.isConnected,
    isLoading: wallet.isLoading,
    error: wallet.error,
    usdcBalance: wallet.usdcBalance,
    connect: wallet.connect,
    disconnect: wallet.disconnect,
    sendUserOperation: wallet.sendUserOperation,
    legacyWallet,
  }), [wallet, legacyWallet])

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  )
}

/* ─── Consumer hook ─── */

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWalletContext must be used within <WalletProvider>')
  return ctx
}
