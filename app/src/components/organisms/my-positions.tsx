import { useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Pulse, Pause, Play } from '@phosphor-icons/react'
import { StreamSlider } from '#/components/molecules/stream-slider'
import { ScoreNumber } from '#/components/atoms/score-number'
import { formatUSDC, formatRate, formatLvst, formatRunway, formatShares } from '#/utils/format'
import type { Position } from '#/utils/mock'
import type { OptionsVault } from '@livestreak/options'
import { isOptionsModeEnabled } from '#/utils/env'
import { useOptionsContext } from '#/providers/options-provider'
import { useLaneEditor } from '#/hooks/use-lane-editor'

interface Props {
  positions: Position[]
  vaults: OptionsVault[]
}

const YES = '#00ff87'
const NO = '#ff2d78'

// One vault = one card, even when the viewer holds shares on BOTH sides (streamed one, switched, streamed the
// other). Group the per-side positions by vault; the card lights the streaming side and shows held shares on
// each. NO is left / YES is right to match the slider's NO↔YES axis.
interface VaultGroup {
  vaultId: string
  yes?: Position
  no?: Position
  resolved: boolean
}

function groupByVault(positions: Position[]): VaultGroup[] {
  const order: string[] = []
  const map = new Map<string, VaultGroup>()
  for (const p of positions) {
    let g = map.get(p.vaultId)
    if (!g) { g = { vaultId: p.vaultId, resolved: false }; map.set(p.vaultId, g); order.push(p.vaultId) }
    g[p.side] = p
    if (p.resolved) g.resolved = true
  }
  return order.map(id => map.get(id)!)
}

const sidesOf = (g: VaultGroup): Position[] => [g.no, g.yes].filter(Boolean) as Position[]

export function MyPositions({ positions }: Props) {
  const groups = groupByVault(positions)
  const activeGroups = groups.filter(g => !g.resolved)
  const resolvedGroups = groups.filter(g => g.resolved)
  // Realized, on-chain-derived totals only: winnings collected and consolation LVST. A net P&L would need
  // a per-position cost basis, which streaming records nowhere on-chain — so it's intentionally not shown.
  const resolved = positions.filter(p => p.resolved)
  const returned = resolved.reduce((s, p) => s + (p.won ? (p.payout ?? 0) : 0), 0)
  const lvstEarned = resolved.reduce((s, p) => s + (!p.won ? (p.lvstReceived ?? 0) : 0), 0)

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '14px 10px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 20, padding: '0 2px' }}>
        <SummaryCard label="ACTIVE" value={activeGroups.length.toString()} accent={YES} />
        <SummaryCard label="RETURNED" value={formatUSDC(returned)} accent={returned > 0 ? YES : undefined} />
        <SummaryCard label="LVST EARNED" value={formatLvst(lvstEarned)} accent={lvstEarned > 0 ? '#ffd553' : undefined} />
      </div>
      {activeGroups.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Open Positions</SectionLabel>
          {activeGroups.map((g, i) => <ActiveVaultCard key={g.vaultId} group={g} index={i} />)}
        </div>
      )}
      {resolvedGroups.length > 0 && (
        <div>
          <SectionLabel>Resolved</SectionLabel>
          {resolvedGroups.map((g, i) => <ResolvedVaultCard key={g.vaultId} group={g} index={i} />)}
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

function ActiveVaultCard({ group, index = 0 }: { group: VaultGroup; index?: number }) {
  // Bind the editor to the side that owns the live control: the streaming side, else a paused one, else
  // whichever exists. The slider spans NO↔YES, so dragging across centre still switches sides from here.
  const sides = sidesOf(group)
  // Prefer streaming, then paused, then DEPLETED (explicit — so the control's amber pill reads DEPLETED,
  // not PAUSED, when the money actually ran dry), then whatever exists.
  const primary = sides.find(p => p.status === 'streaming')
    ?? sides.find(p => p.status === 'paused')
    ?? sides.find(p => p.status === 'depleted')
    ?? sides[0]
  const { editing, busy, error, paused, depleted, rate, shownSide, streaming, canPause, startEditing, onDrag, togglePause } = useLaneEditor(primary)
  // The lit side = the one streaming now (follows the finger mid-drag via shownSide). Held side recedes.
  const activeSide = streaming ? shownSide : null
  // Both paused and depleted are "stopped — tap ▶ to resume" (resume re-funds a depleted lane). Not a dead-end.
  const stopped = paused || depleted

  return (
    <motion.div
      initial={{ opacity: 0, transform: 'translateY(6px)', filter: 'blur(4px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }}
      transition={{ type: 'spring', stiffness: 320, damping: 30, delay: index * 0.04 }}
      style={{
        background: 'rgba(255,255,255,0.025)',
        border: `1px solid ${streaming ? 'rgba(0,255,135,0.15)' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: 12, padding: '14px 16px', marginBottom: 10,
        transition: 'border-color 0.24s cubic-bezier(0.23, 1, 0.32, 1)',
      }}
    >
      {/* Header: question (tap → vault) + match-minute */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <span
          style={{
            fontSize: 13, color: 'rgba(255,255,255,0.75)', fontWeight: 500, fontFamily: 'var(--font-sans)',
            lineHeight: 1.4, flex: 1, minWidth: 0,
          }}
        >
          {primary.option}
        </span>
        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.25)', flexShrink: 0, marginTop: 2 }}>{primary.minute}'</span>
      </div>

      {/* Both sides, always — NO left / YES right. Lit = streaming; the other recedes but stays legible. */}
      <div style={{ display: 'flex', gap: 8 }}>
        <SideHolding side="no" pos={group.no} active={activeSide === 'no'} />
        <SideHolding side="yes" pos={group.yes} active={activeSide === 'yes'} />
      </div>

      {/* Label line — short, concise context for the state pill below. Streaming → live rate + runway.
          The two stopped states differ by ONE fact (is the money still there?), so the label carries exactly
          that: paused = deposit kept (resume is free); depleted = add funds (resume needs a top-up). Never the
          state word itself — that lives on the pill, so no line repeats another. */}
      <div style={{ minHeight: 14, marginTop: 12, marginBottom: 6, display: 'flex', alignItems: 'center' }}>
        {streaming ? (
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.4)' }}>
            <span style={{ fontWeight: 600, color: editing ? '#00c8ff' : YES }}>{formatRate(rate)}</span>
            {primary.runwayEndMs !== undefined && primary.runwayEndMs > Date.now() && (
              <> · {formatRunway(primary.runwayEndMs - Date.now())} left</>
            )}
          </span>
        ) : paused ? (
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.4)' }}>deposit kept</span>
        ) : depleted ? (
          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.4)' }}>add funds to resume</span>
        ) : null}
      </div>

      {/* Control. Stopped → ONE amber pill: ▶ + the state in full (tap to resume; depleted re-funds). The
          state word lives here and nowhere else. Streaming/editing → the pause button + live slider (the
          slider IS the control). */}
      {stopped ? (
        <button
          onClick={togglePause}
          disabled={busy}
          title={depleted ? 'Resume — tops up & restarts (needs USDC on your account)' : 'Resume stream (your deposit is kept)'}
          style={{
            width: '100%', minHeight: 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            borderRadius: 7,
            background: 'rgba(255,122,0,0.1)', border: '1px solid rgba(255,122,0,0.3)',
            cursor: busy ? 'wait' : 'pointer', color: '#ff7a00',
            fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em',
            opacity: busy ? 0.5 : 1, transition: 'opacity 0.15s, background 0.15s',
          }}
        >
          <Play size={12} weight="fill" />
          {busy ? 'RESUMING…' : depleted ? 'DEPLETED' : 'PAUSED'}
        </button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
          <button
            onClick={togglePause}
            disabled={busy}
            title="Pause stream (keeps your deposit) — or drag the slider to the middle"
            style={{
              width: 36, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              cursor: busy ? 'wait' : 'pointer', color: 'rgba(255,255,255,0.35)',
              opacity: busy ? 0.4 : 1, transition: 'all 0.15s cubic-bezier(0.23, 1, 0.32, 1)',
            }}
          >
            <Pause size={12} weight="fill" />
          </button>
          <div style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', alignItems: 'center', minHeight: 36 }}>
            <div style={{ flex: 1, padding: '0 4px' }}>
              <StreamSlider side={shownSide} rate={rate} onChange={onDrag} disabled={!editing} pausable={canPause} compact />
            </div>
            <AnimatePresence>
              {!editing && (
                <motion.button
                  key="adjust-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  onClick={startEditing}
                  disabled={busy}
                  style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(13,13,28,0.8)', backdropFilter: 'blur(1px)',
                    borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)',
                    cursor: busy ? 'wait' : 'pointer', fontSize: 10, fontWeight: 600,
                    fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
                    color: busy ? '#00c8ff' : 'rgba(255,255,255,0.4)', zIndex: 3,
                  }}
                >
                  {busy ? 'APPLYING…' : 'ADJUST RATE'}
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
      {/* Write-failure surface — absolute so it never shifts the card (no CLS); auto-clears on the next edit. */}
      <AnimatePresence>
        {error && (
          <motion.p
            key="write-error"
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ margin: '8px 0 0', fontSize: 10, fontFamily: 'var(--font-mono)', color: '#ff7a7a', lineHeight: 1.4 }}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// One side's holding: "% of side" is the hero (instantly meaningful — your slice of the payout split), with
// the abbreviated share count beneath it. Lit when streaming; recedes (dim, no fill) when merely held.
function SideHolding({ side, pos, active }: { side: 'yes' | 'no'; pos?: Position; active: boolean }) {
  const c = side === 'yes' ? YES : NO
  const has = !!pos
  // Streaming → the number steps every 3–6s to the REAL current value (sh is the SDK's live accrual; % is
  // the settled ratio). Held/paused/depleted → static. Nothing is projected in the UI, so nothing bounces.
  const statusLabel = active
    ? 'STREAMING'
    : pos?.status === 'paused' ? 'PAUSED' : pos?.status === 'depleted' ? 'DEPLETED' : null

  return (
    <div style={{
      flex: 1, minWidth: 0, borderRadius: 10, padding: '10px 12px',
      border: `1px solid ${active ? c + '55' : has ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)'}`,
      background: active ? c + '0e' : 'transparent',
      opacity: has || active ? 1 : 0.45,
      transition: 'border-color 0.24s ease, background 0.24s ease, opacity 0.24s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 7, minHeight: 12 }}>
        <span style={{
          fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.06em',
          color: active || has ? c : 'rgba(255,255,255,0.3)', transition: 'color 0.2s',
        }}>{side.toUpperCase()}</span>
        {active && <div className="live-dot" style={{ width: 4, height: 4, borderRadius: '50%', background: c }} />}
        {statusLabel && (
          <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', color: statusLabel === 'PAUSED' || statusLabel === 'DEPLETED' ? '#ff7a00' : 'rgba(255,255,255,0.3)' }}>{statusLabel}</span>
        )}
      </div>
      {has ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            {pos!.sharePercent !== undefined ? (
              <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: active ? '#fff' : 'rgba(255,255,255,0.82)', fontVariantNumeric: 'tabular-nums', lineHeight: 1, display: 'inline-flex', alignItems: 'baseline' }}>
                <ScoreNumber value={pos!.sharePercent} live={active} max={100} format={{ maximumFractionDigits: 1 }} />
                <span style={{ marginLeft: 1 }}>%</span>
              </span>
            ) : (
              <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.82)', lineHeight: 1 }}>—</span>
            )}
            {pos!.sharePercent !== undefined && <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>of side</span>}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 3, fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <ScoreNumber value={pos!.shares} live={active} format={{ maximumFractionDigits: 2 }} />
            <span>sh</span>
          </div>
        </>
      ) : (
        <div className="mono" style={{ fontSize: 13, color: 'rgba(255,255,255,0.2)' }}>—</div>
      )}
    </div>
  )
}

// One resolved vault = one settlement card. Rows are conditional: a YES/NO row shows only for a side you
// actually streamed, and the Overstream row only when a stream ran past the result. Individual buttons are
// gone — a single "Cash out" runs the whole settlement per-vault (stop this vault's lanes → claim LVST on
// the losing side → withdraw winnings + overstream). It never touches your other vaults or shared balance.
function ResolvedVaultCard({ group, index = 0 }: { group: VaultGroup; index?: number }) {
  const optionsEnabled = isOptionsModeEnabled()
  const options = useOptionsContext()
  const useOptions = optionsEnabled && options.isConnected
  const sides = sidesOf(group)
  const option = sides[0]?.option ?? ''
  const overstream = sides.reduce((s, p) => s + (p.overstream ?? 0), 0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | undefined>()

  // Enabled when there's anything left to collect: unclaimed winnings, an UNCLAIMED loss-mint, or overstream.
  // A loss whose LVST was already claimed (canClaimLoss false) still shows its earned amount but no longer
  // arms Cash out. Label softens to "Claim" for a pure-loss vault (LVST only, no cash).
  const hasCash = sides.some(p => p.won && (p.payout ?? 0) > 0) || overstream > 0
  const canSettle = useOptions && (
    sides.some(p => (p.won && (p.payout ?? 0) > 0) || (!p.won && p.canClaimLoss === true)) || overstream > 0
  )
  const [claimed, setClaimed] = useState(false)
  const onSettle = async () => {
    if (!canSettle || busy) return
    setBusy(true); setErr(undefined)
    try {
      await options.settleVault(group.vaultId)
      setClaimed(true)
    }
    catch (e) {
      const msg = e instanceof Error ? e.message : 'Cash out failed'
      // The engine gates a payout until the drips cycle boundary after resolve (SettlementPending) —
      // turn that into a wait-and-retry hint instead of a raw error.
      setErr(/settlement.?pending/i.test(msg) ? 'Winnings unlock in a few seconds — try again shortly.' : msg)
    }
    finally { setBusy(false) }
  }
  // Once claimed (or nothing left to collect) the button is a dead, non-clickable "CLAIMED" marker.
  const settled = claimed || !canSettle

  return (
    <motion.div
      initial={{ opacity: 0, transform: 'translateY(6px)', filter: 'blur(4px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }}
      transition={{ type: 'spring', stiffness: 320, damping: 30, delay: index * 0.04 }}
      style={{
        background: 'rgba(255,255,255,0.015)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 10, padding: '12px 14px', marginBottom: 8,
      }}
    >
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 400, marginBottom: 10 }}>{option}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sides.map(p => <SettleRow key={p.side} pos={p} />)}
        {overstream > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.06em', color: 'rgba(0,200,255,0.7)' }}>OVERSTREAM</span>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.28)' }}>streamed past the result</span>
              <span
                role="img"
                aria-label="What is overstream?"
                title="USDC that streamed after the vault resolved. Refunded when you cash out."
                style={{ fontSize: 10, color: 'rgba(0,200,255,0.5)', cursor: 'help', fontFamily: 'var(--font-mono)', lineHeight: 1 }}
              >ⓘ</span>
            </div>
            <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,200,255,0.8)', fontVariantNumeric: 'tabular-nums' }}>+{formatUSDC(overstream)}</span>
          </div>
        )}
      </div>
      {useOptions && (
        <>
          <button
            onClick={onSettle}
            disabled={settled || busy}
            title="Collects winnings + overstream and mints any LVST, then stops this vault's stream — this vault only"
            style={{
              width: '100%', marginTop: 12, minHeight: 34, borderRadius: 7,
              background: settled ? 'rgba(255,255,255,0.03)' : 'rgba(0,255,135,0.1)',
              border: `1px solid ${settled ? 'rgba(255,255,255,0.08)' : 'rgba(0,255,135,0.3)'}`,
              color: settled ? 'rgba(255,255,255,0.3)' : '#00ff87',
              fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
              cursor: settled ? 'default' : busy ? 'wait' : 'pointer',
              transition: 'opacity 0.15s, background 0.15s',
            }}
          >
            {busy ? 'CLAIMING…' : settled ? 'CLAIMED' : hasCash ? 'Cash out' : 'Claim'}
          </button>
          <AnimatePresence>
            {err && (
              <motion.p key="settle-err" initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                style={{ margin: '8px 0 0', fontSize: 10, fontFamily: 'var(--font-mono)', color: '#ff7a7a', lineHeight: 1.4 }}>
                {err}
              </motion.p>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  )
}

// One settled side: SIDE · won/lost · shares ───── payout ($ if won, LVST if lost). No button — the card's
// single Cash out collects everything.
function SettleRow({ pos }: { pos: Position }) {
  const c = pos.side === 'yes' ? YES : NO
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
          color: c === YES ? 'rgba(0,255,135,0.65)' : 'rgba(255,45,120,0.65)',
          background: c === YES ? 'rgba(0,255,135,0.06)' : 'rgba(255,45,120,0.06)',
          padding: '2px 6px', borderRadius: 4,
        }}>{pos.side.toUpperCase()}</span>
        <span style={{
          fontSize: 10, fontFamily: 'var(--font-mono)',
          color: pos.won ? '#ffd553' : 'rgba(255,255,255,0.3)',
          background: pos.won ? 'rgba(255,213,83,0.1)' : 'rgba(255,255,255,0.04)',
          padding: '2px 6px', borderRadius: 4,
        }}>{pos.won ? 'WON' : 'LOST'}</span>
        {pos.lossClaimed && (
          <span style={{
            fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.04em',
            color: 'rgba(0,200,255,0.7)', background: 'rgba(0,200,255,0.08)', padding: '2px 6px', borderRadius: 4,
          }}>CLAIMED</span>
        )}
        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.3)' }}>{formatShares(pos.shares)} sh</span>
      </div>
      {/* Earned LVST (dimmed once claimed = already collected), with the USDC LOST beneath it in a smaller,
          right-aligned, minus-signed line — so a loss reads "won LVST for it, but lost this much cash". */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: pos.won ? '#ffd553' : pos.lossClaimed ? 'rgba(255,213,83,0.35)' : 'rgba(255,213,83,0.6)', fontVariantNumeric: 'tabular-nums' }}>
          {pos.won ? `+${formatUSDC(pos.payout ?? 0)}` : pos.lvstReceived ? `+${formatLvst(pos.lvstReceived)}` : '—'}
        </span>
        {!pos.won && (pos.lossUSDC ?? 0) > 0 && (
          <span className="mono" style={{ fontSize: 9, fontWeight: 600, color: '#9a9aac', fontVariantNumeric: 'tabular-nums' }}>
            -{formatUSDC(pos.lossUSDC ?? 0)}
          </span>
        )}
      </div>
    </div>
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
