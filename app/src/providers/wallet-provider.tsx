import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { type WalletState } from '#/utils/mock.ts'
import { useOptionsContext } from '#/providers/options-provider'
import { usePreferFixture, useParsedFixture } from '#/hooks/use-fixture-mode'
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
  const preferFixture = usePreferFixture()
  const parsed = useParsedFixture()
  const [mockConnected, setMockConnected] = useState(false)
  const fixtureWallet = parsed.wallet

  const legacyWallet: WalletState = useMemo(() => {
    if (!preferFixture && optionsEnabled && options.isConnected && options.address) {
      return {
        address: `${options.address.slice(0, 6)}...${options.address.slice(-4)}`,
        usdcBalance: options.usdcBalance,
        connected: true,
        sessionKeySigned: true,
      }
    }
    if (preferFixture && mockConnected) {
      return { ...fixtureWallet, connected: true, sessionKeySigned: true }
    }
    return fixtureWallet
  }, [preferFixture, optionsEnabled, options.isConnected, options.address, options.usdcBalance, mockConnected, fixtureWallet])

  const connect = async (password: string) => {
    if (!preferFixture && optionsEnabled) {
      await options.connect(password)
      return
    }
    if (password.trim()) setMockConnected(true)
  }

  const disconnect = () => {
    if (!preferFixture && optionsEnabled) {
      options.disconnect()
      return
    }
    setMockConnected(false)
  }

  const value: WalletContextValue = useMemo(() => ({
    address: !preferFixture && optionsEnabled && options.isConnected ? options.address : null,
    isConnected: !preferFixture && optionsEnabled ? options.isConnected : mockConnected,
    isLoading: !preferFixture && optionsEnabled ? options.isLoading : false,
    error: !preferFixture && optionsEnabled ? options.error : null,
    usdcBalance: !preferFixture && optionsEnabled && options.isConnected
      ? BigInt(Math.round(options.usdcBalance * 1_000_000))
      : 0n,
    connect,
    disconnect,
    legacyWallet,
  }), [preferFixture, optionsEnabled, options, mockConnected, legacyWallet])

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
