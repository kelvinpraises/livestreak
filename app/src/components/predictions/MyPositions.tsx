import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { TrendUp, TrendDown, Pulse, Pause, Play } from '@phosphor-icons/react'
import { StreamSlider } from '#/components/predictions/StreamSlider'
import { formatUSDC, formatRate } from '#/utils/format'
import type { Position, Vault } from '#/data/mock'

interface Props {
  positions: Position[]
  vaults: Vault[]
  onSelectVault: (id: string) => void
}

export function MyPositions({ positions, vaults, onSelectVault }: Props) {
  const active = positions.filter(p => !p.resolved)
  const resolved = positions.filter(p => p.resolved)
  const totalStreamed = positions.reduce((s, p) => s + p.streamed, 0)
  const totalPnl = positions.reduce((s, p) => s + p.pnl, 0)

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '14px 10px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 20, padding: '0 2px' }}>
        <SummaryCard label="ACTIVE" value={active.length.toString()} accent="#00ff87" />
        <SummaryCard label="STREAMED" value={formatUSDC(totalStreamed)} />
        <SummaryCard label="P&L" value={(totalPnl >= 0 ? '+' : '') + formatUSDC(totalPnl)} accent={totalPnl >= 0 ? '#00ff87' : '#ff2d78'} />
      </div>
      {active.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Active Streams</SectionLabel>
          {active.map((p, i) => <ActivePositionRow key={p.vaultId + i} position={p} index={i} onSelectVault={onSelectVault} />)}
        </div>
      )}
      {resolved.length > 0 && (
        <div>
          <SectionLabel>Resolved</SectionLabel>
          {resolved.map((p, i) => <ResolvedRow key={p.vaultId + i} position={p} index={i} />)}
        </div>
      )}
      {positions.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 160, gap: 10 }}>
          <Pulse size={28} color="rgba(255,255,255,0.1)" />
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>No streams yet.<br />Tap a prediction on the video to start.</p>
        </div>
      )}
    </div>
  )
}

function ActivePositionRow({ position: p, index = 0, onSelectVault }: { position: Position; index?: number; onSelectVault: (id: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [paused, setPaused] = useState(false)
  const [liveRate, setLiveRate] = useState<{ side: 'yes' | 'no' | null; rate: number } | null>(null)
  const pos = p.pnl >= 0
  const displayRate = liveRate?.rate ?? p.streamRate
  const displaySide = liveRate?.side ?? p.side
  const streaming = displayRate > 0 && !paused

  // Auto-relock slider after 10s — only counts while pointer is outside
  const relockTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const insideRef = useRef(false)

  const startRelock = useCallback(() => {
    if (relockTimer.current) clearTimeout(relockTimer.current)
    if (editing && !insideRef.current) {
      relockTimer.current = setTimeout(() => setEditing(false), 10000)
    }
  }, [editing])

  useEffect(() => {
    if (!editing) { if (relockTimer.current) clearTimeout(relockTimer.current); return }
    startRelock()
    return () => { if (relockTimer.current) clearTimeout(relockTimer.current) }
  }, [editing, startRelock])

  const handlePointerEnter = useCallback(() => { insideRef.current = true; if (relockTimer.current) clearTimeout(relockTimer.current) }, [])
  const handlePointerLeave = useCallback(() => { insideRef.current = false; startRelock() }, [startRelock])

  return (
    <motion.div
      initial={{ opacity: 0, transform: 'translateY(6px)', filter: 'blur(4px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }}
      transition={{ type: 'spring', stiffness: 320, damping: 30, delay: index * 0.04 }}
      style={{
        background: 'rgba(255,255,255,0.025)',
        border: `1px solid ${streaming ? 'rgba(0,255,135,0.15)' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: 12, padding: '14px 16px', marginBottom: 10,
        transition: 'border-color 0.2s cubic-bezier(0.23, 1, 0.32, 1)',
      }}
    >
      {/* Header: option + P&L */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            onClick={() => onSelectVault(p.vaultId)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
              fontSize: 13, color: 'rgba(255,255,255,0.75)', fontWeight: 500, fontFamily: 'var(--font-sans)',
              marginBottom: 6, display: 'block', lineHeight: 1.4,
            }}
          >
            {p.option}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
              color: displaySide === 'yes' ? '#00ff87' : displaySide === 'no' ? '#ff2d78' : 'rgba(255,255,255,0.3)',
              background: displaySide === 'yes' ? 'rgba(0,255,135,0.1)' : displaySide === 'no' ? 'rgba(255,45,120,0.1)' : 'rgba(255,255,255,0.05)',
              padding: '2px 7px', borderRadius: 4,
              transition: 'color 0.15s, background 0.15s',
            }}>{displaySide?.toUpperCase() ?? '—'}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>{p.minute}'</span>
            {streaming && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: 3,
                fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                color: editing ? '#00c8ff' : '#00ff87',
                transition: 'color 0.15s',
              }}>
                <div className="live-dot" style={{ width: 4, height: 4, borderRadius: '50%', background: editing ? '#00c8ff' : '#00ff87' }} />
                {formatRate(displayRate)}
              </span>
            )}
            {paused && (
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.05)', padding: '1px 5px', borderRadius: 3 }}>PAUSED</span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
            {pos ? <TrendUp size={12} color="#00ff87" /> : <TrendDown size={12} color="#ff2d78" />}
            <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: pos ? '#00ff87' : '#ff2d78' }}>{pos ? '+' : ''}{formatUSDC(p.pnl)}</span>
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 3 }}>{formatUSDC(p.streamed)} in · {formatUSDC(p.currentValue)} val · {p.shares} sh</div>
        </div>
      </div>

      {/* Controls: pause + adjust/slider */}
      <div style={{ width: '50%', height: 1, background: 'rgba(255,255,255,0.04)', margin: '6px auto 0' }} />
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, paddingTop: 14 }}>
        <button
          onClick={() => setPaused(v => !v)}
          style={{
            width: 36, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 6,
            background: paused ? 'rgba(0,255,135,0.08)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${paused ? 'rgba(0,255,135,0.2)' : 'rgba(255,255,255,0.08)'}`,
            cursor: 'pointer',
            color: paused ? '#00ff87' : 'rgba(255,255,255,0.35)',
            transition: 'all 0.15s cubic-bezier(0.23, 1, 0.32, 1)',
          }}
        >
          {paused ? <Play size={12} weight="fill" /> : <Pause size={12} weight="fill" />}
        </button>
        <div onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave} style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', alignItems: 'center', minHeight: 36 }}>
          <div style={{ flex: 1, padding: '0 4px' }}>
            <StreamSlider vaultId={p.vaultId} initialSide={p.side} initialRate={p.streamRate} disabled={!editing} compact onStream={(side, rate) => setLiveRate({ side, rate })} />
          </div>
          <AnimatePresence>
            {!editing && (
              <motion.button
                key="adjust-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                onClick={() => setEditing(true)}
                style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(13,13,28,0.8)',
                  backdropFilter: 'blur(1px)',
                  borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)',
                  cursor: 'pointer', fontSize: 10, fontWeight: 600,
                  fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
                  color: 'rgba(255,255,255,0.4)',
                  zIndex: 3,
                }}
              >
                ADJUST RATE
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}

function ResolvedRow({ position: p, index = 0 }: { position: Position; index?: number }) {
  const pos = p.pnl >= 0
  return (
    <motion.div
      initial={{ opacity: 0, transform: 'translateY(6px)', filter: 'blur(4px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }}
      transition={{ type: 'spring', stiffness: 320, damping: 30, delay: index * 0.04 }}
      style={{
        background: 'rgba(255,255,255,0.015)',
        border: '1px solid rgba(255,255,255,0.04)',
        borderRadius: 10, padding: '12px 14px', marginBottom: 8, opacity: 0.75,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 400, marginBottom: 4 }}>{p.option}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
              color: p.side === 'yes' ? 'rgba(0,255,135,0.6)' : 'rgba(255,45,120,0.6)',
              background: p.side === 'yes' ? 'rgba(0,255,135,0.06)' : 'rgba(255,45,120,0.06)',
              padding: '2px 6px', borderRadius: 4,
            }}>{p.side.toUpperCase()}</span>
            <span style={{
              fontSize: 10, fontFamily: 'var(--font-mono)',
              color: p.won ? '#ffd553' : 'rgba(255,255,255,0.3)',
              background: p.won ? 'rgba(255,213,83,0.1)' : 'rgba(255,255,255,0.04)',
              padding: '2px 6px', borderRadius: 4,
            }}>{p.won ? 'WON' : 'LOST'}</span>
            {p.won && p.payout && (
              <span className="mono" style={{ fontSize: 10, color: '#ffd553' }}>+{formatUSDC(p.payout)}</span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
            {pos ? <TrendUp size={11} color="rgba(0,255,135,0.6)" /> : <TrendDown size={11} color="rgba(255,45,120,0.6)" />}
            <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: pos ? 'rgba(0,255,135,0.7)' : 'rgba(255,45,120,0.7)' }}>{pos ? '+' : ''}{formatUSDC(p.pnl)}</span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', marginBottom: 5 }}>{label}</div>
      <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: accent ?? 'rgba(255,255,255,0.8)' }}>{value}</div>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)', padding: '4px 4px 10px' }}>{children}</div>
}
