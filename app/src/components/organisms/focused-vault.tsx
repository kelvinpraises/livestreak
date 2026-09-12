import { useState, useEffect, useMemo, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { Fire, X, ArrowRight } from '@phosphor-icons/react'
import { StreamSlider } from '#/components/molecules/stream-slider'
import { AccrualPreview, mapAccrualPreview } from '#/components/molecules/accrual-preview'
import { formatCountdown, formatMultiplier, formatUSDC, formatRate, formatShares, calcPoolPct } from '#/utils/format'
import type { OptionsVault } from '@livestreak/options'
import { streamMode, streamLabel } from '#/utils/stream-action'
import { useVaultFundingControls } from '#/hooks/use-vault-funding-controls'
import { useVaultView } from '#/hooks/use-vault-views'
import { useAccrualPreview } from '#/hooks/use-accrual-preview'
import { useStreamDraft } from '#/hooks/use-stream-draft'

interface Props {
  vault: OptionsVault
  onDismiss: () => void
  onStream?: (vaultId: string, side: 'yes' | 'no', rate: number, durationMinutes?: number) => void
  onGoToMint?: () => void
}

function sideStyle(active: boolean, accent: string): CSSProperties {
  return {
    padding: '8px 14px', borderRadius: 7, cursor: 'pointer',
    border: `1px solid ${active ? accent : 'rgba(255,255,255,0.12)'}`,
    background: active ? `${accent}22` : 'rgba(255,255,255,0.04)',
    color: active ? accent : 'rgba(255,255,255,0.5)',
    fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
    transition: 'background 0.15s, border-color 0.15s, color 0.15s',
  }
}

const mintCtaStyle: CSSProperties = {
  width: '100%', marginTop: 18, padding: '12px 0',
  fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-display)', letterSpacing: '0.03em',
  borderRadius: 8, cursor: 'pointer',
  border: '1px solid rgba(0,200,255,0.4)',
  background: 'linear-gradient(135deg, rgba(0,200,255,0.16), rgba(0,255,135,0.09))',
  color: '#00c8ff',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  transition: 'background 0.2s, border-color 0.2s',
}

export function FocusedVault({ vault, onDismiss, onStream, onGoToMint }: Props) {
  const view = useVaultView(vault.vaultId)
  const funding = useVaultFundingControls(vault.vaultId)
  const userPosition = view.userPosition
  const hotUntil = vault.steward.hotUntilMs ?? null

  const draft = useStreamDraft(vault.vaultId)
  const streamSide = draft.side
  const streamRate = draft.rate
  const [hotMs, setHotMs] = useState(hotUntil ? Math.max(0, hotUntil - Date.now()) : 0)

  const { preview, loading: previewLoading } = useAccrualPreview(vault.vaultId, streamSide, streamRate)
  const accrualPreview = useMemo(() => mapAccrualPreview(preview), [preview])

  const streamable = vault.status === 'open' || vault.status === 'hot'
  const needsMint = funding.useOptions && !funding.hasNft
  const mode = streamMode({ needsMint, side: streamSide, rate: streamRate, activeFundedSide: funding.activeFundedSide })
  const canStream = streamRate >= 0.01 && (!funding.useOptions || (funding.hasNft && streamable))
  const stopReady = funding.stopFn !== undefined && !funding.stopFn.disabled
  const canAct = mode === 'stop' ? stopReady : (mode === 'stream' || mode === 'switch') && canStream
  const sharePrice = funding.useOptions
    ? (streamSide === 'yes' ? view.sharePriceYes : streamSide === 'no' ? view.sharePriceNo : undefined)
    : undefined

  // Only the HOT window carries a real on-chain deadline; tick it while hot.
  useEffect(() => {
    if (!hotUntil) return
    const tick = setInterval(() => setHotMs(Math.max(0, hotUntil - Date.now())), 500)
    return () => clearInterval(tick)
  }, [hotUntil])

  const yesTotal = view.poolYes ?? Number(vault.pools.yes)
  const noTotal = view.poolNo ?? Number(vault.pools.no)
  const totalPool = view.poolTotal ?? noTotal + yesTotal
  const poolPct = calcPoolPct(noTotal, yesTotal)
  const yesOdds = view.odds?.yesMultiplier ?? (yesTotal > 0 ? totalPool / yesTotal : 0)
  const noOdds = view.odds?.noMultiplier ?? (noTotal > 0 ? totalPool / noTotal : 0)
  const isHot = vault.status === 'hot'
  const hasPos = !!userPosition

  const commit = async () => {
    if (mode === 'stop' && funding.activeFundedSide) {
      await funding.stopFunding(vault.vaultId, funding.activeFundedSide)
      draft.clear()
    } else if (streamSide) {
      onStream?.(vault.vaultId, streamSide, streamRate)
    }
  }

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
              <span className="mono" style={{ fontSize: 9, fontWeight: 600, color: '#00ff87' }}>OPEN</span>
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

      <div style={{ marginBottom: 18 }}>
        <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${(1 - poolPct) * 100}%`, background: '#ff2d78', opacity: 0.5 }} />
          <div style={{ width: `${poolPct * 100}%`, background: '#00ff87', opacity: 0.5 }} />
        </div>
      </div>

      {hasPos && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '6px 10px', background: 'rgba(255,255,255,0.025)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.05)' }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em' }}>YOUR POS</span>
          <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: userPosition!.side === 'yes' ? '#00ff87' : '#ff2d78' }}>{userPosition!.side.toUpperCase()}</span>
          <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{formatRate(userPosition!.rate)}</span>
          <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{formatShares(userPosition!.shares)} shares</span>
        </div>
      )}

      <StreamSlider
        side={streamSide}
        rate={streamRate}
        onChange={draft.change}
        disabled={!streamable}
        pausable={!!funding.activeFundedSide}
      />

      <div role="group" aria-label="Choose side and stream rate" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
        <button
          type="button"
          data-testid={`fund-side-no-${vault.vaultId}`}
          aria-pressed={streamSide === 'no'}
          onClick={() => draft.setSide('no')}
          style={sideStyle(streamSide === 'no', '#ff2d78')}
        >
          NO
        </button>
        <button
          type="button"
          data-testid={`fund-side-yes-${vault.vaultId}`}
          aria-pressed={streamSide === 'yes'}
          onClick={() => draft.setSide('yes')}
          style={sideStyle(streamSide === 'yes', '#00ff87')}
        >
          YES
        </button>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={10}
          step={0.1}
          data-testid={`fund-amount-input-${vault.vaultId}`}
          aria-label="Stream rate in USDC per minute"
          value={streamRate > 0 ? Number(streamRate.toFixed(2)) : ''}
          placeholder="0.00"
          onChange={e => {
            const parsed = parseFloat(e.target.value)
            draft.setRate(Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 10)) : 0)
          }}
          style={{
            width: 90, padding: '8px 8px', borderRadius: 7,
            border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)',
            color: 'rgba(255,255,255,0.85)', fontSize: 12, fontFamily: 'var(--font-mono)', textAlign: 'right',
          }}
        />
        <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>/min</span>
      </div>

      {funding.useOptions && (
        <AccrualPreview side={streamSide} rate={streamRate} sharePrice={sharePrice} preview={accrualPreview} loading={previewLoading} />
      )}

      {streamSide && streamRate > 0.01 && (
        <div style={{ marginTop: 12 }}>
          <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
            Draws from your shared balance — top up in Positions
          </span>
        </div>
      )}

      {mode === 'mint' ? (
        <button onClick={onGoToMint} style={mintCtaStyle}>
          {streamLabel(mode, { needsMint, side: streamSide, rate: streamRate, activeFundedSide: funding.activeFundedSide })}
          <ArrowRight size={13} weight="bold" />
        </button>
      ) : (
        <button
          disabled={!canAct}
          title={funding.stopFn?.disabledReason}
          onClick={commit}
          style={{
            width: '100%', marginTop: 18, padding: '12px 0',
            fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-display)',
            letterSpacing: '0.04em', borderRadius: 8, border: 'none',
            cursor: canAct ? 'pointer' : 'default',
            background: mode === 'stop' ? '#ff7a00' : streamSide === 'yes' ? '#00ff87' : streamSide === 'no' ? '#ff2d78' : 'rgba(255,255,255,0.06)',
            color: mode === 'stop' || streamSide ? '#000' : 'rgba(255,255,255,0.25)',
            opacity: canAct ? 1 : 0.45,
            transition: 'background 0.2s, color 0.2s, opacity 0.2s',
          }}
        >
          {streamLabel(mode, { needsMint, side: streamSide, rate: streamRate, activeFundedSide: funding.activeFundedSide })}
        </button>
      )}
    </motion.div>
  )
}
