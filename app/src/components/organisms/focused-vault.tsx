import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Clock, Fire, X } from '@phosphor-icons/react'
import { StreamSlider, mapAccrualPreview } from '#/components/molecules/stream-slider'
import { formatCountdown, formatMultiplier, formatUSDC, calcPoolPct } from '#/utils/format'
import type { OptionsVault } from '@livestreak/options'
import { DEFAULT_FUND_DURATION_MIN, fundCommitmentUsd } from '#/utils/options'
import { useVaultFundingControls } from '#/hooks/use-vault-funding-controls'
import { useVaultView } from '#/hooks/use-vault-views'
import { useAccrualPreview } from '#/hooks/use-accrual-preview'

interface Props {
  vault: OptionsVault
  onDismiss: () => void
  onStream?: (vaultId: string, side: 'yes' | 'no', rate: number, durationMinutes?: number) => void
}

export function FocusedVault({ vault, onDismiss, onStream }: Props) {
  const view = useVaultView(vault.vaultId)
  const hotUntil = vault.steward.hotUntilMs ?? null
  const yesTotal = view.poolYes ?? Number(vault.pools.yes)
  const noTotal = view.poolNo ?? Number(vault.pools.no)
  const userPosition = view.userPosition
  const funding = useVaultFundingControls(vault.vaultId)
  const [hotMs, setHotMs] = useState(hotUntil ? Math.max(0, hotUntil - Date.now()) : 0)
  const [expiryMs, setExpiryMs] = useState(Math.max(0, vault.timing.expiresAtMs - Date.now()))
  const [streamSide, setStreamSide] = useState<'yes' | 'no' | null>(
    funding.activeFundedSide ?? userPosition?.side ?? null,
  )
  const [streamRate, setStreamRate] = useState(userPosition ? 0.8 : 0)
  const [fundDurationMin, setFundDurationMin] = useState(DEFAULT_FUND_DURATION_MIN)
  const { preview, loading: previewLoading } = useAccrualPreview(vault.vaultId, streamSide, streamRate)

  const selectedFundFn = streamSide === 'yes'
    ? funding.fundYes
    : streamSide === 'no'
      ? funding.fundNo
      : undefined
  const canStream = !!streamSide
    && streamRate >= 0.01
    && (!funding.useOptions || (selectedFundFn !== undefined && !selectedFundFn.disabled))

  const accrualPreview = useMemo(
    () => mapAccrualPreview(preview),
    [preview],
  )

  useEffect(() => {
    if (vault.status !== 'hot' && vault.status !== 'open') return
    const tick = setInterval(() => {
      if (hotUntil) setHotMs(Math.max(0, hotUntil - Date.now()))
      setExpiryMs(Math.max(0, vault.timing.expiresAtMs - Date.now()))
    }, 500)
    return () => clearInterval(tick)
  }, [hotUntil, vault.timing.expiresAtMs, vault.status])

  const poolPct = calcPoolPct(noTotal, yesTotal)
  const isHot = vault.status === 'hot'
  const totalPool = view.poolTotal ?? noTotal + yesTotal
  // A2: authoritative odds; recompute only as mock-mode fallback.
  const yesOdds = view.odds?.yesMultiplier ?? (yesTotal > 0 ? totalPool / yesTotal : 0)
  const noOdds = view.odds?.noMultiplier ?? (noTotal > 0 ? totalPool / noTotal : 0)
  const hasPos = !!userPosition

  return (
    <motion.div
      initial={{ opacity: 0, transform: 'translateY(-12px)', filter: 'blur(4px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }}
      exit={{ opacity: 0, transform: 'translateY(-8px)', filter: 'blur(4px)', transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 350, damping: 28 }}
      style={{
        flexShrink: 0,
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '18px 18px 18px',
        background: isHot
          ? 'linear-gradient(180deg, rgba(255,45,120,0.04) 0%, transparent 100%)'
          : 'linear-gradient(180deg, rgba(0,255,135,0.02) 0%, transparent 100%)',
      }}
    >
      {/* Header: question + dismiss */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="display" style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)', lineHeight: 1.35, marginBottom: 6, letterSpacing: '0.01em' }}>
            {vault.question}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isHot ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(255,45,120,0.12)', border: '1px solid rgba(255,45,120,0.3)', borderRadius: 4, padding: '1px 6px' }}>
                <Fire size={9} color="#ff2d78" />
                <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: '#ff2d78' }}>HOT {formatCountdown(hotMs)}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <Clock size={9} color="rgba(255,255,255,0.3)" />
                <span className="mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{formatCountdown(expiryMs)}</span>
              </div>
            )}
            <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{formatUSDC(totalPool)} pooled</span>
          </div>
        </div>
        <button
          onClick={onDismiss}
          style={{
            width: 26, height: 26, borderRadius: 6, flexShrink: 0,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'rgba(255,255,255,0.4)',
          }}
        >
          <X size={12} />
        </button>
      </div>

      {/* Odds: YES vs NO */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          padding: '10px 0', borderRadius: 8,
          background: hasPos && userPosition?.side === 'yes' ? 'rgba(0,255,135,0.1)' : 'rgba(0,255,135,0.04)',
          border: `1px solid ${hasPos && userPosition?.side === 'yes' ? 'rgba(0,255,135,0.3)' : 'rgba(0,255,135,0.12)'}`,
        }}>
          <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: '#00ff87' }}>{formatMultiplier(yesOdds)}</span>
          <span className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'rgba(0,255,135,0.6)' }}>YES · {formatUSDC(yesTotal)}</span>
        </div>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          padding: '10px 0', borderRadius: 8,
          background: hasPos && userPosition?.side === 'no' ? 'rgba(255,45,120,0.1)' : 'rgba(255,45,120,0.04)',
          border: `1px solid ${hasPos && userPosition?.side === 'no' ? 'rgba(255,45,120,0.3)' : 'rgba(255,45,120,0.12)'}`,
        }}>
          <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: '#ff2d78' }}>{formatMultiplier(noOdds)}</span>
          <span className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'rgba(255,45,120,0.6)' }}>NO · {formatUSDC(noTotal)}</span>
        </div>
      </div>

      {/* Pool split bar */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${(1 - poolPct) * 100}%`, background: '#ff2d78', opacity: 0.5 }} />
          <div style={{ width: `${poolPct * 100}%`, background: '#00ff87', opacity: 0.5 }} />
        </div>
      </div>

      {/* Your position (if any) */}
      {hasPos && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '6px 10px', background: 'rgba(255,255,255,0.025)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em' }}>YOUR POS</span>
          <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: userPosition!.side === 'yes' ? '#00ff87' : '#ff2d78' }}>{userPosition!.side.toUpperCase()}</span>
          <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>${userPosition!.streamed.toFixed(2)} in</span>
          <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{userPosition!.shares} shares</span>
        </div>
      )}

      {/* Slider — immediately visible, the whole point */}
      <StreamSlider
        vaultId={vault.vaultId}
        initialSide={funding.activeFundedSide ?? userPosition?.side ?? null}
        initialRate={userPosition ? 0.8 : 0}
        fundYes={funding.fundYes}
        fundNo={funding.fundNo}
        stopFn={funding.stopFn}
        activeFundedSide={funding.activeFundedSide}
        onStopFunding={funding.activeFundedSide
          ? () => funding.stopFunding(vault.vaultId, funding.activeFundedSide!)
          : undefined}
        sharePriceYes={view.sharePriceYes ?? 1}
        sharePriceNo={view.sharePriceNo ?? 1}
        accrualPreview={accrualPreview}
        previewLoading={previewLoading}
        showPreview={funding.useOptions}
        onStream={(side, rate) => { setStreamSide(side); setStreamRate(rate) }}
      />

      {streamSide && streamRate > 0.01 && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}>FUND FOR</span>
            <select
              value={fundDurationMin}
              onChange={e => setFundDurationMin(Number(e.target.value))}
              style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6, color: '#fff', fontSize: 11, fontFamily: 'var(--font-mono)', padding: '4px 8px',
              }}
            >
              {[15, 30, 60, 90, 120].map(min => (
                <option key={min} value={min}>{min} min</option>
              ))}
            </select>
          </div>
          <p className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', margin: 0 }}>
            Funding ${fundCommitmentUsd(streamRate, fundDurationMin).toFixed(2)} over {fundDurationMin} min
          </p>
        </div>
      )}

      {/* Start streaming button */}
      <button
        disabled={!canStream}
        title={selectedFundFn?.disabledReason}
        onClick={() => streamSide && onStream?.(vault.vaultId, streamSide, streamRate, fundDurationMin)}
        style={{
          width: '100%', marginTop: 18, padding: '12px 0',
          fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-display)',
          letterSpacing: '0.04em', borderRadius: 8, border: 'none', cursor: canStream ? 'pointer' : 'default',
          background: streamSide === 'yes' ? '#00ff87' : streamSide === 'no' ? '#ff2d78' : 'rgba(255,255,255,0.06)',
          color: streamSide ? '#000' : 'rgba(255,255,255,0.25)',
          opacity: canStream ? 1 : 0.45,
          transition: 'background 0.2s, color 0.2s',
        }}
      >
        {funding.activeFundedSide
          ? 'STOP STREAM TO CHANGE SIDE'
          : !streamSide
            ? 'DRAG TO CHOOSE A SIDE'
            : hasPos
              ? `UPDATE STREAM → ${streamSide.toUpperCase()}`
              : `STREAM → ${streamSide.toUpperCase()}`}
      </button>
    </motion.div>
  )
}
