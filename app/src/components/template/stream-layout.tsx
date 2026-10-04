import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { AnimatePresence } from 'framer-motion'
import { StreamBar } from '#/components/molecules/stream-bar.tsx'
import { BalanceBar } from '#/components/molecules/balance-bar.tsx'
import { WinNotification, useWinNotifications } from '#/components/organisms/win-notification.tsx'
import { VideoPlayer } from '#/components/organisms/video-player.tsx'
import { NikoNikoCard } from '#/components/molecules/niko-niko-card.tsx'
import { VaultList } from '#/components/organisms/vault-list.tsx'
import { WalletControls } from '#/components/molecules/wallet-controls.tsx'
import { useVaults } from '#/hooks/use-vaults.ts'
import { usePositions } from '#/hooks/use-positions.ts'
import { useWebSocket } from '#/hooks/use-websocket.ts'
import { useFlow } from '#/hooks/use-flow.ts'
import { useWalletContext } from '#/providers/wallet-provider.tsx'
import { useOptionsContext } from '#/providers/options-provider.tsx'
import type { useHostStream } from '#/hooks/use-host-stream.ts'
import { env, isOptionsModeEnabled } from '#/utils/env.ts'
import { panelToStream } from '#/utils/options'
import { resolveStreamFeed } from '#/utils/stream'
import {
  shouldUseLiveFeed,
  nextLiveFeedLatch,
  resolveLiveFeedEnabled,
  type LiveFeedLatch,
} from '#/utils/live-feed'

interface StreamLayoutProps {
  streamTitle: string
  category: string
  totalPooled: number
  totalPooledRatePerSec?: number
  streamId: string
  hostStream: ReturnType<typeof useHostStream>
  requestedVaultId?: string
}

export function StreamLayout({ streamTitle, category, totalPooled, totalPooledRatePerSec, streamId, requestedVaultId, hostStream }: StreamLayoutProps) {
  const vaults = useVaults(streamId)
  const positions = usePositions(streamId)
  const { events } = useWebSocket()
  const { legacyWallet } = useWalletContext()
  const { flow } = useFlow()
  const { board, fundStream, isConnected: optionsConnected, setActiveMarketId, chain, setChain, claiming: walletBusy } = useOptionsContext()
  const optionsEnabled = isOptionsModeEnabled()

  const { notifications, push, dismiss } = useWinNotifications()
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(null)

  useEffect(() => { setSelectedVaultId(requestedVaultId ?? null) }, [streamId, requestedVaultId])

  // Resolve this broadcast's chain pointer and Host playback source.
  const hostDetail = hostStream.stream
  const wrongChain = !!hostDetail?.chain && hostDetail.chain !== chain
  const streamPointer = optionsEnabled && board && hostDetail && !wrongChain && !board.dataError
    ? panelToStream(board.panel, streamId)
    : undefined
  useEffect(() => {
    if (optionsEnabled) setActiveMarketId(wrongChain || !hostDetail ? undefined : hostDetail.marketId)
  }, [optionsEnabled, hostDetail?.marketId, wrongChain, setActiveMarketId])

  // Recomputed every ~3s board poll, so it FLICKERS — between polls the board can momentarily drop
  // this market or report a non-'live' status, flipping eligibility false→true.
  const liveEligible =
    hostStream.ready && shouldUseLiveFeed(streamPointer, hostDetail)
  const streamEnded = streamPointer?.status === 'ended' || hostDetail?.streamStatus === 'ended'

  // A transient flip would tear down the live MSE session AND remount the keyed <video>. So LATCH
  // eligibility sticky per streamId (see nextLiveFeedLatch): once live it stays enabled until the pointer
  // reports 'ended'.
  const [liveLatch, setLiveLatch] = useState<LiveFeedLatch>({ streamId, enabled: false })
  useEffect(() => {
    setLiveLatch(prev => nextLiveFeedLatch(prev, streamId, liveEligible, streamEnded))
  }, [streamId, liveEligible, streamEnded])
  const liveEnabled = resolveLiveFeedEnabled(liveLatch, streamId, liveEligible, streamEnded)

  const liveStreamId = hostDetail?.marketId ?? streamId
  const streamMedia = useMemo(() => {
    const resolved = resolveStreamFeed(streamPointer, hostDetail)
    // Not live → the recording / watchUrl (replay, native <video src>). Live → the encode-once fMP4
    // fan-out over MSE, keyed to the host viewer endpoint. The player opens the host viewer socket; if it
    // errors it falls back to the recording via VideoPlayer's own state.
    if (!liveEnabled) return resolved
    return { kind: 'live' as const, live: { streamId: liveStreamId, baseUrl: env.hostBaseUrl } }
  }, [streamPointer, hostDetail, liveEnabled, liveStreamId])

  const floatingVaults = vaults.filter(v => v.status === 'open' || v.status === 'hot')

  const handleNikoClick = useCallback((vaultId: string) => {
    setSelectedVaultId(prev => prev === vaultId ? null : vaultId)
  }, [])

  const handleStream = useCallback(async (
    vaultId: string,
    side: 'yes' | 'no',
    rate: number,
  ) => {
    const vault = vaults.find(v => v.vaultId === vaultId)

    if (optionsEnabled) {
      if (wrongChain) throw new Error('Switch to the market’s network before funding.')
      if (!hostDetail || hostDetail.stale || board?.dataError) throw new Error('Refresh market data before funding.')
      if (!optionsConnected) throw new Error('Connect your wallet before funding.')
      const txId = await fundStream(vaultId, side, rate)
      push({ type: 'stream', rate, side, option: vault?.question ?? vaultId, txId })
    } else {
      throw new Error('Funding is unavailable: options runtime is disabled.')
    }
    // Keep the question and player mounted so confirmation stays beside the stream.
  }, [vaults, push, optionsEnabled, optionsConnected, fundStream, wrongChain, hostDetail, board?.dataError])

  // S3/A2 — a thin, programmatic commit seam so accessibility tooling and headless E2E can fund a
  // vault WITHOUT synthesizing a sub-pixel OS mouse drag on the slider. Takes a total USDC amount
  // (what a human reads) and converts it to the stream rate the funding flow expects. Goes through
  // the exact same `handleStream` path as the slider/buttons (mint-if-needed → fund → notify).
  useEffect(() => {
    const seam = (
      vaultId: string,
      side: 'yes' | 'no',
      amountUsdc: number,
      durationMinutes = 60,
    ) => {
      // Convert a human-read total USDC into the per-minute stream rate the funding flow expects.
      const minutes = durationMinutes > 0 ? durationMinutes : 60
      const rate = amountUsdc / minutes
      return handleStream(vaultId, side, rate)
    }
    ;(window as unknown as { livestreakFund?: typeof seam }).livestreakFund = seam
    return () => {
      delete (window as unknown as { livestreakFund?: typeof seam }).livestreakFund
    }
  }, [handleStream])

  // Win/loss toast fires on the unresolved → resolved transition we actually witness this session. Each
  // (vault:side) must be seen UNRESOLVED at least once before a resolved sighting notifies — so positions
  // already settled when the page loads never burst toasts, and the 3s board poll can't re-fire a key.
  const notifiedResolutions = useRef(new Map<string, boolean>())
  useEffect(() => {
    const seen = notifiedResolutions.current
    for (const p of positions) {
      // Skip paused rows: pausing drops the on-chain lane, so the re-injected row carries no win/loss
      // verdict (`won`/payout/lvst). Every other resolved position has its verdict projected alongside
      // `resolved` in the same snapshot, so a non-paused resolved sighting is safe to read.
      if (p.status === 'paused') continue
      const key = `${p.vaultId}:${p.side}`
      const wasUnresolved = seen.get(key) === false
      seen.set(key, p.resolved)
      if (p.resolved && wasUnresolved) {
        if (p.won) push({ type: 'win', amount: p.payout ?? 0, option: p.option })
        else push({ type: 'loss', lvstReceived: p.lvstReceived ?? 0, option: p.option })
      }
    }
  }, [positions, push])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      background: 'var(--color-bg)', position: 'relative', overflow: 'hidden',
    }}>
      <div className="grid-bg" />

      {/* Nav */}
      <div className="stream-nav" style={{
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <WalletControls />
        </div>
      </div>

      {/* Stream bar */}
      <StreamBar verified={!!hostDetail && !hostDetail.stale} status={hostDetail?.stale ? 'stale' : !hostStream.ready ? 'loading' : !hostDetail ? 'unavailable' : streamEnded ? 'ended' : hostDetail.isLive ? 'live' : 'offline'} streamTitle={streamTitle} totalPooled={totalPooled} totalPooledRatePerSec={totalPooledRatePerSec} />

      {/* Main content: LEFT video + RIGHT predictions */}
      <div className="stream-split" style={{ flex: 1, display: 'flex', position: 'relative', zIndex: 1, overflow: 'hidden' }}>
        {/* LEFT — Video (60%) */}
        <div className="stream-video-pane" style={{ flex: '3 1 60%', minWidth: 0, position: 'relative', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
          {hostDetail?.stale && <p role="status" style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 20, color: '#ffd553' }}>Last observed stream state · index refresh failed or is stale.</p>}
          {hostStream.error && <p role="alert" style={{ position: 'absolute', top: 12, left: 12, zIndex: 20, color: '#ffd553' }}>Stream details unavailable. Retrying…</p>}
          <VideoPlayer media={streamMedia} ready={hostStream.ready} />

          {/* NikoNiko floating cards */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 10 }}>
            <AnimatePresence>
              {floatingVaults.map((vault) => (
                <NikoNikoCard key={vault.vaultId} vault={vault} onClickCard={handleNikoClick} />
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* RIGHT — Predictions (40%) */}
        <div className="stream-predictions-pane" style={{ flex: '2 1 40%', minWidth: 0, display: 'flex', flexDirection: 'column', background: 'rgba(7,7,15,0.98)', overflow: 'hidden' }}>
          {wrongChain && <div className="funding-notice" role="status">This market is on {hostDetail!.chain}. Your wallet is on {chain}.
            <button className="funding-text-button" disabled={walletBusy} onClick={() => setChain(hostDetail!.chain!)}>Switch to {hostDetail!.chain}</button>
          </div>}
          {!wrongChain && <VaultList vaults={vaults} events={events} positions={positions} selectedVaultId={selectedVaultId} streamId={streamId} onDismissVault={() => setSelectedVaultId(null)} onStream={handleStream} />}
        </div>
      </div>

      {/* Balance bar */}
      <BalanceBar flow={flow} wallet={legacyWallet} />

      {/* Overlays */}
      <WinNotification notifications={notifications} onDismiss={dismiss} />
    </div>
  )
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    Sports: '#00ff87',
    Tech: '#00ff87',
    Esports: '#00c8ff',
    Politics: '#ff7a00',
    Entertainment: '#ffd553',
  }
  return colors[category] ?? '#00ff87'
}
