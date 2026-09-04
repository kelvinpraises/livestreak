import { useState, useCallback } from 'react'
import { Link } from '@tanstack/react-router'
import { AnimatePresence } from 'framer-motion'
import { StreamBar } from '#/components/hud/StreamBar.tsx'
import { BalanceBar } from '#/components/hud/BalanceBar.tsx'
import { WinNotification, useWinNotifications } from '#/components/hud/WinNotification.tsx'
import { VideoPlayer } from '#/components/video/VideoPlayer.tsx'
import { NikoNikoCard } from '#/components/video/NikoNikoCard.tsx'
import { VaultList } from '#/components/predictions/VaultList.tsx'
import { ConnectButton } from '#/components/wallet/ConnectButton.tsx'
import { useVaults } from '#/hooks/useVaults.ts'
import { useWebSocket } from '#/hooks/useWebSocket.ts'
import { useFlow } from '#/hooks/useFlow.ts'
import { useWalletContext } from '#/contexts/WalletContext.tsx'
import { mockPositions } from '#/data/mock.ts'

interface StreamLayoutProps {
  streamTitle: string
  category: string
  totalPooled: number
}

export function StreamLayout({ streamTitle, category, totalPooled }: StreamLayoutProps) {
  const vaults = useVaults()
  const { frame, events } = useWebSocket()
  const { legacyWallet } = useWalletContext()
  const { flow, stake, unstake, claimDividends, claiming } = useFlow()
  const { notifications, push, dismiss } = useWinNotifications()
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(null)

  const floatingVaults = vaults.filter(v => v.status === 'open' || v.status === 'hot')

  const handleNikoClick = useCallback((vaultId: string) => {
    setSelectedVaultId(prev => prev === vaultId ? null : vaultId)
  }, [])

  const handleStream = useCallback((vaultId: string, side: 'yes' | 'no', rate: number) => {
    // mock commit — Tier 2 swaps this for options writer.fund(vaultId, side, rate)
    const vault = vaults.find(v => v.id === vaultId)
    push({ type: 'stream', rate, side, option: vault?.option ?? vaultId })
    setSelectedVaultId(null)
  }, [vaults, push])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      background: 'var(--color-bg)', position: 'relative', overflow: 'hidden',
    }}>
      <div className="grid-bg" />

      {/* Nav */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', height: 48,
        borderBottom: '1px solid rgba(255,255,255,0.055)',
        background: 'rgba(7,7,15,0.95)', backdropFilter: 'blur(20px)',
        flexShrink: 0, zIndex: 30, position: 'relative',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <div style={{
              width: 26, height: 26, borderRadius: 7,
              background: 'linear-gradient(135deg, #00ff87, #00c8ff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#000', fontFamily: 'var(--font-display)' }}>L</span>
            </div>
            <span className="display" style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.02em' }}>LiveStreak</span>
          </Link>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '1px 5px' }}>ALPHA</span>
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />
          <span style={{
            fontSize: 10, fontWeight: 600, color: getCategoryColor(category),
            background: `${getCategoryColor(category)}12`,
            border: `1px solid ${getCategoryColor(category)}25`,
            padding: '2px 8px', borderRadius: 4,
            fontFamily: 'var(--font-mono)',
          }}>{category}</span>
        </div>
        <ConnectButton />
      </div>

      {/* Stream bar */}
      <StreamBar frame={frame} streamTitle={streamTitle} totalPooled={totalPooled} />

      {/* Main content: LEFT video + RIGHT predictions */}
      <div className="stream-split" style={{ flex: 1, display: 'flex', position: 'relative', zIndex: 1, overflow: 'hidden' }}>
        {/* LEFT — Video (60%) */}
        <div className="stream-video-pane" style={{ flex: '3 1 60%', minWidth: 0, position: 'relative', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
          <VideoPlayer streamTitle={streamTitle} />

          {/* NikoNiko floating cards */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 10 }}>
            <AnimatePresence>
              {floatingVaults.map((vault, i) => (
                <NikoNikoCard key={vault.id} vault={vault} index={i} total={floatingVaults.length} onClickCard={handleNikoClick} />
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* RIGHT — Predictions (40%) */}
        <div className="stream-predictions-pane" style={{ flex: '2 1 40%', minWidth: 0, display: 'flex', flexDirection: 'column', background: 'rgba(7,7,15,0.98)', overflow: 'hidden' }}>
          <VaultList vaults={vaults} events={events} positions={mockPositions} selectedVaultId={selectedVaultId} onDismissVault={() => setSelectedVaultId(null)} onStream={handleStream} />
        </div>
      </div>

      {/* Balance bar */}
      <BalanceBar flow={flow} wallet={legacyWallet} onStake={stake} onUnstake={unstake} onClaim={claimDividends} claiming={claiming} />

      {/* Overlays */}
      <WinNotification notifications={notifications} onDismiss={dismiss} />
    </div>
  )
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    Tech: '#00ff87',
    Esports: '#00c8ff',
    Politics: '#ff7a00',
    Entertainment: '#ffd553',
  }
  return colors[category] ?? '#00ff87'
}
