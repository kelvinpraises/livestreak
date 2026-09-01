import { useState, useEffect, type CSSProperties } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, Fire, CheckCircle, XCircle, CaretDown, TrendUp, Users } from '@phosphor-icons/react'
import { StreamSlider } from '#/components/predictions/StreamSlider'
import { formatUSDC, formatCountdown, formatMultiplier, formatMinute, calcPoolPct } from '#/utils/format'
import type { Vault } from '#/data/mock'

export function VaultCard({ vault, index = 0 }: { vault: Vault; index?: number }) {
  const [expanded, setExpanded] = useState(false)
  const [hotMs, setHotMs] = useState(vault.hotUntil ? Math.max(0, vault.hotUntil - Date.now()) : 0)
  const [expiryMs, setExpiryMs] = useState(Math.max(0, vault.expiresAt - Date.now()))

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
  const isResolved = vault.status === 'resolved'
  const isWin = isResolved && vault.userWon === true
  const isLoss = isResolved && vault.userWon === false
  const isOpen = vault.status === 'open'
  const hasPos = !!vault.userPosition
  const canBet = isOpen || isHot

  let cardStyle: CSSProperties = {}
  if (isHot) cardStyle = { borderColor: 'rgba(255,45,120,0.4)' }
  else if (isWin) cardStyle = { borderColor: 'rgba(255,213,83,0.3)' }
  else if (isLoss) cardStyle = { borderColor: 'rgba(255,255,255,0.04)', opacity: 0.7 }
  else if (isOpen && hasPos) cardStyle = { borderColor: 'rgba(0,255,135,0.2)' }

  const noMultiplier = vault.yesTotal > 0 ? (vault.noTotal + vault.yesTotal) / vault.noTotal : 1

  return (
    <motion.div
      id={`vault-${vault.id}`}
      layout
      initial={{ opacity: 0, transform: 'translateY(8px)', filter: 'blur(4px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }}
      exit={{ opacity: 0, transform: 'translateY(-6px)', filter: 'blur(4px)' }}
      transition={{ type: 'spring', stiffness: 320, damping: 30, delay: index * 0.04 }}
      className={`glass-card ${isHot ? 'card-hot' : ''} ${isWin ? 'card-win' : ''}`}
      style={{ marginBottom: 6, overflow: 'visible', ...cardStyle }}
    >
      {isWin && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 12,
          background: 'linear-gradient(135deg, rgba(255,213,83,0.05) 0%, transparent 50%)',
          pointerEvents: 'none', zIndex: 0,
        }} />
      )}

      <div style={{ padding: '10px 14px', position: 'relative', zIndex: 1 }}>
        {/* Row 1: Question + Status */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="display" style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.88)', lineHeight: 1.35, marginBottom: 3, letterSpacing: '0.01em' }}>
              {vault.option}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
                {formatMinute(vault.createdMinute ?? 0)} &middot; {vault.type}
              </span>
              {hasPos && canBet && (
                <span style={{
                  fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
                  color: vault.userPosition!.side === 'yes' ? '#00ff87' : '#ff2d78',
                  background: vault.userPosition!.side === 'yes' ? 'rgba(0,255,135,0.1)' : 'rgba(255,45,120,0.1)',
                  padding: '1px 5px', borderRadius: 3,
                }}>
                  {vault.userPosition!.side.toUpperCase()} &middot; {formatUSDC(vault.userPosition!.streamed)}
                </span>
              )}
            </div>
          </div>
          <StatusBadge vault={vault} hotMs={hotMs} expiryMs={expiryMs} />
        </div>

        {/* Row 2: YES / NO buttons */}
        {canBet && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <button className="vault-bet-btn vault-bet-yes" onClick={() => setExpanded(true)} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '7px 0', borderRadius: 7, border: '1px solid rgba(0,255,135,0.25)',
              background: hasPos && vault.userPosition?.side === 'yes' ? 'rgba(0,255,135,0.15)' : 'rgba(0,255,135,0.06)',
              cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', color: '#00ff87' }}>YES</span>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(0,255,135,0.6)' }}>+{formatMultiplier(vault.multiplier)}</span>
            </button>
            <button className="vault-bet-btn vault-bet-no" onClick={() => setExpanded(true)} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '7px 0', borderRadius: 7, border: '1px solid rgba(255,45,120,0.25)',
              background: hasPos && vault.userPosition?.side === 'no' ? 'rgba(255,45,120,0.15)' : 'rgba(255,45,120,0.06)',
              cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', color: '#ff2d78' }}>NO</span>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(255,45,120,0.6)' }}>+{formatMultiplier(noMultiplier)}</span>
            </button>
          </div>
        )}

        {/* Row 3: Pool bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: canBet ? 4 : 8 }}>
          <span className="mono" style={{ fontSize: 10, color: '#ff2d78', minWidth: 28, textAlign: 'right' }}>{formatUSDC(vault.noTotal)}</span>
          <div style={{ flex: 1, height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '100%', background: 'linear-gradient(90deg, rgba(255,45,120,0.0) 0%, #00ff87 100%)', transform: `scaleX(${poolPct})`, transformOrigin: 'left', transition: 'transform 0.25s cubic-bezier(0.23, 1, 0.32, 1)' }} />
          </div>
          <span className="mono" style={{ fontSize: 10, color: '#00ff87', minWidth: 28 }}>{formatUSDC(vault.yesTotal)}</span>
        </div>

        {/* Win / Loss states */}
        <AnimatePresence>
          {isWin && <WinState payout={vault.payout ?? 0} />}
          {isLoss && <LossState flowReceived={vault.flowReceived ?? 0} />}
        </AnimatePresence>

        {/* Hot exit burn */}
        {isHot && vault.exitBurn && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'rgba(255,45,120,0.06)', border: '1px solid rgba(255,45,120,0.15)',
            borderRadius: 6, padding: '5px 10px', marginBottom: 4, marginTop: 4,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Fire size={11} color="#ff2d78" />
              <span style={{ fontSize: 10, color: '#ff2d78', fontWeight: 600 }}>EXIT BURN</span>
            </div>
            <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: '#ff7a00' }}>{vault.exitBurn}%</span>
          </div>
        )}

        {/* Expand toggle */}
        <button onClick={() => setExpanded(e => !e)} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          width: '100%', marginTop: 2, padding: '3px 0 0',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'rgba(255,255,255,0.18)', fontSize: 10,
        }}>
          <span>{expanded ? 'collapse' : 'details'}</span>
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
            <CaretDown size={11} />
          </motion.div>
        </button>
      </div>

      {/* Expanded section */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { type: 'spring', stiffness: 400, damping: 35, opacity: { duration: 0.1 } } }}
            transition={{ type: 'spring', stiffness: 350, damping: 32 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 14px' }}>
              {canBet && (
                <div style={{ marginBottom: 14 }}>
                  <StreamSlider vaultId={vault.id} initialSide={vault.userPosition?.side ?? null} initialRate={vault.userPosition ? 0.8 : 0} />
                </div>
              )}
              <ExpandedDetails vault={vault} poolPct={poolPct} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function StatusBadge({ vault, hotMs, expiryMs }: { vault: Vault; hotMs: number; expiryMs: number }) {
  if (vault.status === 'hot') return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div className="broadcast-corners broadcast-corners-pink" style={{
        display: 'flex', alignItems: 'center', gap: 3,
        background: 'rgba(255,45,120,0.12)', border: '1px solid rgba(255,45,120,0.35)',
        borderRadius: 5, padding: '2px 8px', overflow: 'visible',
      }}>
        <Fire size={10} color="#ff2d78" />
        <span className="display" style={{ fontSize: 10, fontWeight: 700, color: '#ff2d78', letterSpacing: '0.06em' }}>HOT</span>
      </div>
      <span className="mono" style={{ fontSize: 10, color: '#ff7a00', textShadow: '0 0 8px rgba(255,122,0,0.3)' }}>{formatCountdown(hotMs)}</span>
    </div>
  )
  if (vault.status === 'resolved') {
    if (vault.userWon === true) return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <CheckCircle size={12} color="#ffd553" weight="fill" />
        <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: '#ffd553' }}>WON</span>
      </div>
    )
    if (vault.userWon === false) return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <XCircle size={12} color="rgba(255,255,255,0.25)" />
        <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>RESOLVED</span>
      </div>
    )
    return <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>RESOLVED</span>
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 3,
        background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.18)',
        borderRadius: 5, padding: '2px 6px',
      }}>
        <div className="live-dot" style={{ width: 5, height: 5, borderRadius: '50%', background: '#00ff87' }} />
        <span className="mono" style={{ fontSize: 10, fontWeight: 600, color: '#00ff87' }}>OPEN</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Clock size={9} color="rgba(255,255,255,0.25)" />
        <span className="mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{formatCountdown(expiryMs)}</span>
      </div>
    </div>
  )
}

function WinState({ payout }: { payout: number }) {
  return (
    <motion.div initial={{ scale: 0.95, opacity: 0, filter: 'blur(4px)' }} animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, filter: 'blur(4px)', transition: { duration: 0.12 } }} transition={{ type: 'spring', stiffness: 350, damping: 30 }} style={{
      background: 'linear-gradient(135deg, rgba(255,213,83,0.08) 0%, rgba(255,150,0,0.04) 100%)',
      border: '1px solid rgba(255,213,83,0.25)', borderRadius: 7, padding: '8px 12px', marginBottom: 4,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <CheckCircle size={14} color="#ffd553" weight="fill" />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#ffd553' }}>You won</span>
      </div>
      <span className="display text-shimmer" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.02em' }}>${payout.toFixed(2)}</span>
    </motion.div>
  )
}

function LossState({ flowReceived }: { flowReceived: number }) {
  return (
    <motion.div initial={{ opacity: 0, transform: 'translateY(6px)', filter: 'blur(4px)' }} animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }} exit={{ opacity: 0, filter: 'blur(4px)', transition: { duration: 0.12 } }} transition={{ type: 'spring', stiffness: 350, damping: 30 }} style={{
      background: 'rgba(0,200,255,0.04)', border: '1px solid rgba(0,200,255,0.1)',
      borderRadius: 7, padding: '7px 12px', marginBottom: 4,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 1 }}>LOSERS BECOME OWNERS</div>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: '#00c8ff' }}>+{flowReceived.toLocaleString()} $FLOW</span>
      </div>
      <button className="btn-ghost" style={{ fontSize: 10, padding: '4px 10px' }}>Stake</button>
    </motion.div>
  )
}

function ExpandedDetails({ vault, poolPct }: { vault: Vault; poolPct: number }) {
  const yesOdds = vault.noTotal > 0 ? (vault.noTotal + vault.yesTotal) / vault.yesTotal : 0
  const noOdds = vault.yesTotal > 0 ? (vault.noTotal + vault.yesTotal) / vault.noTotal : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <Mini label="Total pool" value={`$${(vault.noTotal + vault.yesTotal).toFixed(0)}`} />
        <Mini label="YES odds" value={`${yesOdds.toFixed(2)}x`} accent="#00ff87" />
        <Mini label="NO odds" value={`${noOdds.toFixed(2)}x`} accent="#ff2d78" />
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
          <span>NO {(100 - poolPct * 100).toFixed(0)}%</span>
          <span>YES {(poolPct * 100).toFixed(0)}%</span>
        </div>
        <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ display: 'flex', height: '100%' }}>
            <div style={{ width: `${(1 - poolPct) * 100}%`, background: '#ff2d78', opacity: 0.6 }} />
            <div style={{ width: `${poolPct * 100}%`, background: '#00ff87', opacity: 0.6 }} />
          </div>
        </div>
      </div>
      {vault.userPosition && (
        <div style={{
          background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 7, padding: '8px 10px',
        }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginBottom: 6, letterSpacing: '0.06em' }}>YOUR POSITION</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            <Mini label="Side" value={vault.userPosition.side.toUpperCase()} accent={vault.userPosition.side === 'yes' ? '#00ff87' : '#ff2d78'} />
            <Mini label="Streamed" value={`$${vault.userPosition.streamed.toFixed(2)}`} />
            <Mini label="Shares" value={vault.userPosition.shares.toString()} />
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Users size={10} color="rgba(255,255,255,0.2)" />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{vault.id}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <TrendUp size={10} color="rgba(255,255,255,0.2)" />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{new Date(vault.createdAt).toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  )
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginBottom: 2, letterSpacing: '0.05em' }}>{label}</div>
      <div className="mono" style={{ fontSize: 12, fontWeight: 600, color: accent ?? 'rgba(255,255,255,0.75)' }}>{value}</div>
    </div>
  )
}
