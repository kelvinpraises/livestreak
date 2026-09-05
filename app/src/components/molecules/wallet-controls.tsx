import { ChainSelector } from '#/components/molecules/chain-selector'
import { ConnectButton } from '#/components/molecules/connect-button'

export function WalletControls() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <ChainSelector />
      <ConnectButton />
    </div>
  )
}
