import { useRef, useState, useLayoutEffect } from 'react'
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion'

const MAX_RATE = 10
const MIN_RATE = 0.1 // lowest streamable rate; below it the centre is a pause (pausable) or floors to MIN
const DETENT_STEP = 0.1 // snap increment in the crunchy low zone
const DETENT_MAX = 1 // detents apply at/below $1/min; above it the slider runs free
const THUMB_R = 12
const NEUTRAL = '#7c8595'
const PAUSE = '#ff7a00' // amber — matches the niko/vault cards' stop/pause CTA (not green)

// Quadratic curve: the low end gets far more travel per dollar, so small rates are easy to land on
// precisely ("crunchy"), while the top stays fast. `mag` is the 0..1 fraction of half-travel.
const magToRate = (mag: number) => MAX_RATE * mag * mag
const rateToMag = (rate: number) => Math.sqrt(Math.min(Math.max(rate, 0), MAX_RATE) / MAX_RATE)

// Detent stops shown as faint ticks ($0.10 … $1.00), placed on the curve so they line up with the snap.
const DETENTS: number[] = []
for (let d = DETENT_STEP; d <= DETENT_MAX + 1e-9; d += DETENT_STEP) DETENTS.push(Number(d.toFixed(2)))

interface Props {
  side: 'yes' | 'no' | null
  rate: number
  onChange: (side: 'yes' | 'no' | null, rate: number) => void
  disabled?: boolean
  compact?: boolean
  /** When true, dragging the thumb to the dead centre pauses the running stream: it emits `(null, 0)`
   *  — one signal, no YES/NO. Off ⇒ the centre just floors to MIN_RATE (a new stream has nothing to
   *  pause). Only enable it when a live stream exists. */
  pausable?: boolean
}

/**
 * A controlled NO↔YES rate picker. `side` + `rate` are the single source of truth, owned by the parent;
 * the thumb mirrors them and every gesture reports back through `onChange`. It holds no rate/side of its
 * own, so a sibling number input bound to the same state stays perfectly in sync.
 *
 * Mapping is quadratic so the low end is fine-grained, and snaps to $0.10 detents below $1/min — small
 * rates are precise ("crunchy"), the top is fast. The bottom floors at MIN_RATE — except on a `pausable`
 * slider, where the dead centre emits `(null, 0)` to pause. A tiny haptic fires per detent (Android).
 */
export function StreamSlider({ side, rate, onChange, disabled = false, compact = false, pausable = false }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hw, setHw] = useState(0)
  const x = useMotionValue(0)
  const lastRate = useRef<number | null>(null)
  const belowFloor = useRef(false) // sticky: true once a drag crosses below the lowest rate (pause), to ×1.3

  const halfWidth = () => Math.max(1, (trackRef.current?.clientWidth ?? 280) / 2 - THUMB_R)

  useLayoutEffect(() => {
    const w = halfWidth()
    setHw(w)
    if (dragging) return
    const sign = side === 'no' ? -1 : 1
    const target = side ? sign * rateToMag(rate) * w : 0
    const controls = animate(x, target, { type: 'spring', stiffness: 500, damping: 30 })
    return () => controls.stop()
  }, [side, rate, dragging, x])

  // Map a pixel offset from centre → (side, rate) on the quadratic curve. The dead centre pauses on a
  // `pausable` slider; otherwise the bottom is a HARD FLOOR at MIN_RATE (no fling-back). Snaps to $0.10
  // detents in the low zone; during a drag the thumb is pulled onto the snapped stop (the crunch).
  // Map a pixel offset from centre → (side, rate) on the quadratic curve, PIN the thumb onto the snapped
  // detent (the crisp "snap"), and report it. The pause zone (below the floor) rides the finger instead — no
  // pin — and eases to dead-centre on release. The old pause↔$0.10 spasm was NOT this pin: it was `pausable`
  // flipping (it was keyed off the draft rate, which hits 0 at centre → pausable false → floor to $0.10 →
  // rate>0 → pausable true → a loop). With a stable, committed-based `pausable` the pin is steady.
  const snapTo = (px: number) => {
    if (disabled) return
    const hw = halfWidth()
    const signed = Math.max(-1, Math.min(1, px / hw))
    let r = magToRate(Math.abs(signed))
    // CENTRE = PAUSE (pausable only): pauses just below the lowest rate, STICKY (hysteresis ×1.4) so the
    // pause/$0.10 edge can't flip-flop. Rides the finger here (no pin); one signal, no YES/NO.
    if (pausable && (belowFloor.current ? r < MIN_RATE * 1.4 : r < MIN_RATE)) {
      belowFloor.current = true
      lastRate.current = 0
      onChange(null, 0)
      return
    }
    belowFloor.current = false
    const low = r < DETENT_MAX
    if (low) r = Math.round(r / DETENT_STEP) * DETENT_STEP // snap value to $0.10 detents in the low zone
    r = Math.min(Math.max(r, MIN_RATE), MAX_RATE) // hard floor / ceiling
    const next: 'yes' | 'no' = signed >= 0 ? 'yes' : 'no'
    x.set((next === 'yes' ? 1 : -1) * rateToMag(r) * hw) // pin the thumb onto the detent — crisp snap
    if (r !== lastRate.current) {
      if (low && typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(3)
      lastRate.current = r
    }
    onChange(next, r)
  }

  const onTrackClick = (e: React.MouseEvent) => {
    belowFloor.current = false // a click is a fresh interaction — no carried-over hysteresis
    const rect = trackRef.current?.getBoundingClientRect()
    if (rect) snapTo(e.clientX - rect.left - rect.width / 2)
  }

  // Pausable + rate driven to ~0 ⇒ the thumb is parked in the centre PAUSE zone: go amber.
  const atPause = pausable && rate < MIN_RATE
  const color = atPause ? PAUSE : side === 'yes' ? '#00ff87' : side === 'no' ? '#ff2d78' : NEUTRAL
  const fill = side && !atPause ? rateToMag(rate) : 0
  const label = atPause
    ? '⏸ release to pause'
    : side && rate >= MIN_RATE ? `$${rate.toFixed(2)}/min → ${side.toUpperCase()}` : null

  const sideLabel = (s: 'yes' | 'no', text: string) => (
    <span style={{
      fontSize: compact ? 9 : 11, fontWeight: compact ? 700 : 600,
      letterSpacing: compact ? '0.06em' : '0.08em', fontFamily: 'var(--font-mono)', flexShrink: 0,
      color: side === s ? (s === 'yes' ? '#00ff87' : '#ff2d78') : 'rgba(255,255,255,0.22)',
      transition: 'color 0.2s',
    }}>{text}</span>
  )

  const track = (
    <div ref={trackRef} onClick={onTrackClick} style={{
      position: 'relative', height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 2,
      cursor: disabled ? 'not-allowed' : 'pointer', flex: compact ? 1 : undefined,
    }}>
      <div style={{ position: 'absolute', right: '50%', top: 0, height: '100%', width: '50%', background: 'linear-gradient(90deg, rgba(255,45,120,0.3), #ff2d78)', borderRadius: 2, transformOrigin: 'right', transform: `scaleX(${side === 'no' ? fill : 0})`, transition: 'transform 0.05s' }} />
      <div style={{ position: 'absolute', left: '50%', top: 0, height: '100%', width: '50%', background: 'linear-gradient(90deg, #00ff87, rgba(0,255,135,0.3))', borderRadius: 2, transformOrigin: 'left', transform: `scaleX(${side === 'yes' ? fill : 0})`, transition: 'transform 0.05s' }} />
      {/* Detent ticks for the crunchy low zone (≤ $1/min each side), placed on the curve so they meet the snap. */}
      {hw > 0 && !disabled && DETENTS.flatMap(d => [-1, 1].map(s => (
        <div key={`${s}:${d}`} style={{ position: 'absolute', left: '50%', top: -1, width: 1, height: 7, background: 'rgba(255,255,255,0.10)', transform: `translateX(${s * rateToMag(d) * hw}px)`, pointerEvents: 'none' }} />
      )))}
      <motion.div
        drag={disabled ? false : 'x'}
        dragMomentum={false}
        dragConstraints={trackRef}
        dragElastic={0.05}
        onDragStart={() => { belowFloor.current = false; setDragging(true) }}
        onDrag={() => snapTo(x.get())}
        onDragEnd={() => { snapTo(x.get()); setDragging(false) }}
        initial={false}
        animate={{ backgroundColor: color }}
        transition={{ backgroundColor: { duration: 0.25, ease: 'easeOut' } }}
        whileTap={{ scale: disabled ? 1 : 1.1 }}
        style={{ x, position: 'absolute', top: -(THUMB_R - 2), left: `calc(50% - ${THUMB_R}px)`, width: THUMB_R * 2, height: THUMB_R * 2, borderRadius: '50%', border: '2px solid rgba(0,0,0,0.3)', boxShadow: dragging ? `0 0 20px ${color}40` : '0 2px 8px rgba(0,0,0,0.5)', cursor: disabled ? 'not-allowed' : 'grab', zIndex: 2, touchAction: 'none' }}
      />
      <div style={{ position: 'absolute', left: '50%', top: pausable ? -4 : -3, width: pausable ? 3 : 1, height: pausable ? 13 : 11, borderRadius: pausable ? 1.5 : 0, background: pausable ? PAUSE : 'rgba(255,255,255,0.22)', opacity: pausable ? (atPause ? 0.95 : 0.45) : 1, transform: 'translateX(-50%)', transition: 'opacity 0.2s', pointerEvents: 'none' }} />
    </div>
  )

  if (compact) {
    return (
      <div style={{ userSelect: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
        {sideLabel('no', 'NO')}
        {track}
        {sideLabel('yes', 'YES')}
      </div>
    )
  }

  return (
    <div style={{ userSelect: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        {sideLabel('no', 'NO')}
        <div style={{ textAlign: 'center', minHeight: 16 }}>
          <AnimatePresence mode="wait" initial={false}>
            {label
              ? <motion.span key="rate" initial={{ opacity: 0, y: -4, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: 4, filter: 'blur(4px)' }} transition={{ duration: 0.12 }} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, color }}>{label}</motion.span>
              : <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-mono)' }}>← drag to stream →</motion.span>}
          </AnimatePresence>
        </div>
        {sideLabel('yes', 'YES')}
      </div>
      {track}
    </div>
  )
}
