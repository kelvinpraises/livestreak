import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Clock, Fire, X } from '@phosphor-icons/react'
import { StreamSlider } from '#/components/predictions/StreamSlider'
import { formatUSDC, formatCountdown, formatMultiplier, calcPoolPct } from '#/utils/format'
import type { Vault } from '#/data/mock'

interface Props {
  vault: Vault
  onDismiss: () => void
}

export function FocusedVault({ vault, onDismiss }: Props) {
  const [hotMs, setHotMs] = useState(vault.hotUntil ? Math.max(0, vault.hotUntil - Date.now()) : 0)
  const [expiryMs, setExpiryMs] = useState(Math.max(0, vault.expiresAt - Date.now()))
  const [streamSide, setStreamSide] = useState<'yes' | 'no' | null>(vault.userPosition?.side ?? null)
  const [streamRate, setStreamRate] = useState(0)

  useEffect(() => {
    if (vault.status !== 'hot' && vault.status !== 'open') return
    const tick = setInterval(() => {
      if (vault.hotUntil) setHotMs(Math.max(0, vault.hotUntil - Date.now()))
      setExpiryMs(Math.max(0, vault.expiresAt - Date.now()))
    }, 500)
    return () => clearInterval(tick)
  }, [vault.hotUntil, vault.expiresAt, vault.status])

  const poolPct = calcPoolPct(vault.noTotal, vault.yesTotal)
  const isHot = vault.status === 'hot'
  const totalPool = vault.noTotal + vault.yesTotal
  const yesOdds = vault.noTotal > 0 ? totalPool / vault.yesTotal : 0
  const noOdds = vault.yesTotal > 0 ? totalPool / vault.noTotal : 0
  const hasPos = !!vault.userPosition

  return (
    <motion.div
      initial={{ opacity: 0, transform: 'translateY(-12px)', filter: 'blur(4px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }}
      exit={{ opacity: 0, transform: 'translateY(-8px)', filter: 'blur(4px)' }}
      transition={{ type: 'spring', stiffness: 350, damping: 28, exit: { duration: 0.15 } }}
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
            {vault.option}
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
            <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>${totalPool.toFixed(0)} pooled</span>
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
          background: hasPos && vault.userPosition?.side === 'yes' ? 'rgba(0,255,135,0.1)' : 'rgba(0,255,135,0.04)',
          border: `1px solid ${hasPos && vault.userPosition?.side === 'yes' ? 'rgba(0,255,135,0.3)' : 'rgba(0,255,135,0.12)'}`,
        }}>
          <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: '#00ff87' }}>{formatMultiplier(yesOdds)}</span>
          <span className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'rgba(0,255,135,0.6)' }}>YES · ${vault.yesTotal.toFixed(0)}</span>
        </div>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          padding: '10px 0', borderRadius: 8,
          background: hasPos && vault.userPosition?.side === 'no' ? 'rgba(255,45,120,0.1)' : 'rgba(255,45,120,0.04)',
          border: `1px solid ${hasPos && vault.userPosition?.side === 'no' ? 'rgba(255,45,120,0.3)' : 'rgba(255,45,120,0.12)'}`,
        }}>
          <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: '#ff2d78' }}>{formatMultiplier(noOdds)}</span>
          <span className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'rgba(255,45,120,0.6)' }}>NO · ${vault.noTotal.toFixed(0)}</span>
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
          <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: vault.userPosition!.side === 'yes' ? '#00ff87' : '#ff2d78' }}>{vault.userPosition!.side.toUpperCase()}</span>
          <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>${vault.userPosition!.streamed.toFixed(2)} in</span>
          <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{vault.userPosition!.shares} shares</span>
        </div>
      )}

      {/* Slider — immediately visible, the whole point */}
      <StreamSlider vaultId={vault.id} initialSide={vault.userPosition?.side ?? null} initialRate={vault.userPosition ? 0.8 : 0} onStream={(side, rate) => { setStreamSide(side); setStreamRate(rate) }} />

      {/* Start streaming button */}
      <button
        disabled={!streamSide || streamRate < 0.01}
        style={{
          width: '100%', marginTop: 18, padding: '12px 0',
          fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-display)',
          letterSpacing: '0.04em', borderRadius: 8, border: 'none', cursor: streamSide ? 'pointer' : 'default',
          background: streamSide === 'yes' ? '#00ff87' : streamSide === 'no' ? '#ff2d78' : 'rgba(255,255,255,0.06)',
          color: streamSide ? '#000' : 'rgba(255,255,255,0.25)',
          transition: 'background 0.2s, color 0.2s',
        }}
      >
        {!streamSide ? 'DRAG TO CHOOSE A SIDE' : hasPos ? `UPDATE STREAM → ${streamSide.toUpperCase()}` : `STREAM → ${streamSide.toUpperCase()}`}
      </button>

      {/* Hot exit burn warning */}
      {isHot && vault.exitBurn && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'rgba(255,45,120,0.06)', border: '1px solid rgba(255,45,120,0.15)',
          borderRadius: 6, padding: '5px 10px', marginTop: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Fire size={11} color="#ff2d78" />
            <span style={{ fontSize: 10, color: '#ff2d78', fontWeight: 600 }}>EXIT BURN</span>
          </div>
          <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: '#ff7a00' }}>{vault.exitBurn}%</span>
        </div>
      )}
    </motion.div>
  )
}
