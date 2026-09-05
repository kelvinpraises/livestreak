import type { ReactNode } from 'react'

import { HostProvider } from '#/providers/host-provider'
import { OptionsProvider } from '#/providers/options-provider'
import { WalletProvider } from '#/providers/wallet-provider'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <HostProvider>
      <OptionsProvider>
        <WalletProvider>
          {children}
        </WalletProvider>
      </OptionsProvider>
    </HostProvider>
  )
}
