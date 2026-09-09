import { useState, useCallback, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { AnimatePresence } from 'framer-motion'
import { StreamBar } from '#/components/molecules/stream-bar.tsx'
import { BalanceBar } from '#/components/molecules/balance-bar.tsx'
import { WinNotification, useWinNotifications } from '#/components/organisms/win-notification.tsx'
import { VideoPlayer } from '#/components/organisms/video-player.tsx'
import { NikoNikoCard } from '#/components/molecules/niko-niko-card.tsx'
import { VaultList } from '#/components/organisms/vault-list.tsx'
import { WalletControls } from '#/components/molecules/wallet-controls.tsx'
import { DemoEdgeToggle } from '#/components/molecules/demo-edge-toggle'
import { useVaults } from '#/hooks/use-vaults.ts'
import { usePositions } from '#/hooks/use-positions.ts'
import { useWebSocket } from '#/hooks/use-websocket.ts'
import { useFlow } from '#/hooks/use-flow.ts'
import { useWalletContext } from '#/providers/wallet-provider.tsx'
import { useOptionsContext } from '#/providers/options-provider.tsx'
import { useHostStream } from '#/hooks/use-host-stream.ts'
import { isOptionsModeEnabled } from '#/utils/env.ts'
import { DEFAULT_FUND_DURATION_MIN, panelToStream } from '#/utils/options'
import { resolveStreamFeed } from '#/utils/stream'

interface StreamLayoutProps {
  streamTitle: string
  category: string
  totalPooled: number
  streamId: string
}

export function StreamLayout({ streamTitle, category, totalPooled, streamId }: StreamLayoutProps) {
  const vaults = useVaults(streamId)
  const positions = usePositions(streamId)
  const { frame, events } = useWebSocket()
  const { legacyWallet } = useWalletContext()
  const { flow, stake, unstake, claimDividends, claiming } = useFlow()
  const { board, fundStream, isConnected: optionsConnected } = useOptionsContext()
  const optionsEnabled = isOptionsModeEnabled()
  const { notifications, push, dismiss } = useWinNotifications()
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(null)

  // A4 + C: each stream resolves ITS OWN feed — the on-chain stream pointer (status + scheme/id) in
  // live mode, falling back to this route's host/fixture stream detail (its own watch URL). No global
  // hardcoded video: demo streams play their per-route fixture feed, live streams their market feed.
  const hostStream = useHostStream(streamId)
  const streamPointer = optionsEnabled && optionsConnected && board
    ? panelToStream(board.panel, streamId)
    : undefined
  const streamMedia = resolveStreamFeed(streamPointer, hostStream.stream)

  const floatingVaults = vaults.filter(v => v.status === 'open' || v.status === 'hot')

  const handleNikoClick = useCallback((vaultId: string) => {
    setSelectedVaultId(prev => prev === vaultId ? null : vaultId)
  }, [])

  const handleStream = useCallback(async (
    vaultId: string,
    side: 'yes' | 'no',
    rate: number,
    durationMinutes = DEFAULT_FUND_DURATION_MIN,
  ) => {
    const vault = vaults.find(v => v.vaultId === vaultId)

    if (optionsEnabled && optionsConnected) {
      try {
        const txId = await fundStream(vaultId, side, rate, durationMinutes)
        push({ type: 'stream', rate, side, option: vault?.question ?? vaultId, txId })
      } catch (err) {
        push({
          type: 'stream',
          rate,
          side,
          option: 'Stream failed',
          subtitle: err instanceof Error ? err.message : 'Fund failed',
        })
      }
    } else {
      push({ type: 'stream', rate, side, option: vault?.question ?? vaultId, mock: true })
    }

    setSelectedVaultId(null)
  }, [vaults, push, optionsEnabled, optionsConnected, fundStream])

  // S3/A2 — a thin, programmatic commit seam so accessibility tooling and headless E2E can fund a
  // vault WITHOUT synthesizing a sub-pixel OS mouse drag on the slider. Takes a total USDC amount
  // (what a human reads) and converts it to the stream rate the funding flow expects. Goes through
  // the exact same `handleStream` path as the slider/buttons (mint-if-needed → fund → notify).
  useEffect(() => {
    const seam = (
      vaultId: string,
      side: 'yes' | 'no',
      amountUsdc: number,
      durationMinutes = DEFAULT_FUND_DURATION_MIN,
    ) => {
      const minutes = durationMinutes > 0 ? durationMinutes : DEFAULT_FUND_DURATION_MIN
      const rate = amountUsdc / minutes
      return handleStream(vaultId, side, rate, minutes)
    }
    ;(window as unknown as { livestreakFund?: typeof seam }).livestreakFund = seam
    return () => {
      delete (window as unknown as { livestreakFund?: typeof seam }).livestreakFund
    }
  }, [handleStream])

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
              <img src="/livestreak-icon.png" alt="LiveStreak" style={{ width: 17, height: 17, objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
            </div>
            <span className="display" style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.02em' }}>LiveStreak</span>
          </Link>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '1px 5px' }}>BETA</span>
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />
          <span style={{
            fontSize: 10, fontWeight: 600, color: getCategoryColor(category),
            background: `${getCategoryColor(category)}12`,
            border: `1px solid ${getCategoryColor(category)}25`,
            padding: '2px 8px', borderRadius: 4,
            fontFamily: 'var(--font-mono)',
          }}>{category}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <DemoEdgeToggle />
          <WalletControls />
        </div>
      </div>

      {/* Stream bar */}
      <StreamBar frame={frame} streamTitle={streamTitle} totalPooled={totalPooled} />

      {/* Main content: LEFT video + RIGHT predictions */}
      <div className="stream-split" style={{ flex: 1, display: 'flex', position: 'relative', zIndex: 1, overflow: 'hidden' }}>
        {/* LEFT — Video (60%) */}
        <div className="stream-video-pane" style={{ flex: '3 1 60%', minWidth: 0, position: 'relative', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
          <VideoPlayer streamTitle={streamTitle} media={streamMedia} ready={hostStream.ready} />

          {/* NikoNiko floating cards */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 10 }}>
            <AnimatePresence>
              {floatingVaults.map((vault, i) => (
                <NikoNikoCard key={vault.vaultId} vault={vault} index={i} total={floatingVaults.length} onClickCard={handleNikoClick} />
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* RIGHT — Predictions (40%) */}
        <div className="stream-predictions-pane" style={{ flex: '2 1 40%', minWidth: 0, display: 'flex', flexDirection: 'column', background: 'rgba(7,7,15,0.98)', overflow: 'hidden' }}>
          <VaultList vaults={vaults} events={events} positions={positions} selectedVaultId={selectedVaultId} streamId={streamId} onDismissVault={() => setSelectedVaultId(null)} onStream={handleStream} />
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
