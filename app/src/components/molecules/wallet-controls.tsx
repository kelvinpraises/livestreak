import { ConnectButton } from '#/components/molecules/connect-button'

// Chain selection now lives inside the wallet button (connect dialog + the connected dropdown), so the
// header no longer needs a standalone chain pill.
export function WalletControls() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <ConnectButton />
    </div>
  )
}
