import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { mockWallet, type WalletState } from '#/utils/mock.ts'
import { useOptionsContext } from '#/providers/options-provider'
import { isOptionsModeEnabled } from '#/utils/env'
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
  const optionsEnabled = isOptionsModeEnabled()
  const [mockConnected, setMockConnected] = useState(false)

  const legacyWallet: WalletState = useMemo(() => {
    if (optionsEnabled && options.isConnected && options.address) {
      return {
        address: `${options.address.slice(0, 6)}...${options.address.slice(-4)}`,
        usdcBalance: options.usdcBalance,
        connected: true,
        sessionKeySigned: true,
      }
    }
    if (!optionsEnabled && mockConnected) {
      return { ...mockWallet, connected: true, sessionKeySigned: true }
    }
    return mockWallet
  }, [optionsEnabled, options.isConnected, options.address, options.usdcBalance, mockConnected])

  const connect = async (password: string) => {
    if (optionsEnabled) {
      await options.connect(password)
      return
    }
    if (password.trim()) setMockConnected(true)
  }

  const disconnect = () => {
    if (optionsEnabled) {
      options.disconnect()
      return
    }
    setMockConnected(false)
  }

  const value: WalletContextValue = useMemo(() => ({
    address: optionsEnabled && options.isConnected ? options.address : null,
    isConnected: optionsEnabled ? options.isConnected : mockConnected,
    isLoading: optionsEnabled ? options.isLoading : false,
    error: optionsEnabled ? options.error : null,
    usdcBalance: optionsEnabled && options.isConnected
      ? BigInt(Math.round(options.usdcBalance * 1_000_000))
      : 0n,
    connect,
    disconnect,
    legacyWallet,
  }), [optionsEnabled, options, mockConnected, legacyWallet])

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWalletContext must be used within <WalletProvider>')
  return ctx
}
