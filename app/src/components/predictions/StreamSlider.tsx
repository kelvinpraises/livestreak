import { useRef, useState } from 'react'
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion'

const MAX_RATE = 10
const THUMB_R = 12

interface Props { vaultId: string; initialSide?: 'yes' | 'no' | null; initialRate?: number; disabled?: boolean; compact?: boolean; onStream?: (side: 'yes' | 'no' | null, rate: number) => void }

export function StreamSlider({ initialSide = null, initialRate = 0, disabled = false, compact = false, onStream }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [side, setSide] = useState<'yes' | 'no' | null>(initialSide)
  const [rate, setRate] = useState(initialRate)
  const x = useMotionValue(0)
  const thumbColor = useTransform(x, [-120, -5, 5, 120], ['#ff2d78', '#ff2d78', '#00ff87', '#00ff87'])

  function getHalfWidth() { return Math.max(1, (trackRef.current?.clientWidth ?? 280) / 2 - THUMB_R) }

  function updateFromX(xVal: number) {
    const hw = getHalfWidth(), pct = Math.max(-1, Math.min(1, xVal / hw))
    const newRate = Math.abs(pct) * MAX_RATE
    const newSide: 'yes' | 'no' | null = pct > 0.05 ? 'yes' : pct < -0.05 ? 'no' : null
    setRate(newRate); setSide(newSide); onStream?.(newSide, newRate)
  }

  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    if (disabled) return
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const clickX = e.clientX - rect.left - rect.width / 2
    animate(x, clickX, { type: 'spring', stiffness: 500, damping: 30 })
    updateFromX(clickX)
  }

  const rateLabel = rate > 0.01 ? `$${rate.toFixed(2)}/min` : null
  const sideColor = side === 'yes' ? '#00ff87' : side === 'no' ? '#ff2d78' : 'rgba(255,255,255,0.2)'

  // Shared track internals
  const trackFills = (
    <>
      <div style={{ position: 'absolute', right: '50%', top: 0, height: '100%', width: '50%', background: 'linear-gradient(90deg, rgba(255,45,120,0.3), #ff2d78)', borderRadius: 2, transform: `scaleX(${side === 'no' ? rate / MAX_RATE : 0})`, transformOrigin: 'right', transition: 'transform 0.05s' }} />
      <div style={{ position: 'absolute', left: '50%', top: 0, height: '100%', width: '50%', background: 'linear-gradient(90deg, #00ff87, rgba(0,255,135,0.3))', borderRadius: 2, transform: `scaleX(${side === 'yes' ? rate / MAX_RATE : 0})`, transformOrigin: 'left', transition: 'transform 0.05s' }} />
      <motion.div
        drag={disabled ? false : 'x'} dragMomentum={false} dragConstraints={trackRef} dragElastic={0.05}
        style={{ x, position: 'absolute', top: -(THUMB_R - 2), left: `calc(50% - ${THUMB_R}px)`, width: THUMB_R * 2, height: THUMB_R * 2, borderRadius: '50%', background: thumbColor, border: '2px solid rgba(0,0,0,0.3)', boxShadow: isDragging ? `0 0 20px ${sideColor}40` : '0 2px 8px rgba(0,0,0,0.5)', cursor: disabled ? 'not-allowed' : 'grab', zIndex: 2, touchAction: 'none' }}
        onDrag={() => updateFromX(x.get())}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={() => { setIsDragging(false); if (Math.abs(x.get()) < getHalfWidth() * 0.05) { animate(x, 0, { type: 'spring', stiffness: 500, damping: 30 }); setSide(null); setRate(0); onStream?.(null, 0) } }}
        whileTap={{ scale: 1.1 }}
      />
      <div style={{ position: 'absolute', left: '50%', top: -2, width: 1, height: 8, background: 'rgba(255,255,255,0.15)', transform: 'translateX(-50%)', pointerEvents: 'none' }} />
    </>
  )

  if (compact) {
    return (
      <div style={{ userSelect: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: side === 'no' ? '#ff2d78' : 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-mono)', flexShrink: 0, transition: 'color 0.2s' }}>NO</span>
          <div ref={trackRef} onClick={handleTrackClick} style={{ position: 'relative', height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 2, cursor: disabled ? 'not-allowed' : 'pointer', flex: 1 }}>
            {trackFills}
          </div>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: side === 'yes' ? '#00ff87' : 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-mono)', flexShrink: 0, transition: 'color 0.2s' }}>YES</span>
        </div>
      </div>
    )
  }

  // Full slider
  return (
    <div style={{ userSelect: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: side === 'no' ? '#ff2d78' : 'rgba(255,255,255,0.25)', transition: 'color 0.2s', fontFamily: 'var(--font-mono)' }}>NO</span>
        <div style={{ textAlign: 'center', minHeight: 16 }}>
          <AnimatePresence mode="wait" initial={false}>
            {rateLabel
              ? <motion.span key="rate" initial={{ opacity: 0, y: -4, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: 4, filter: 'blur(4px)' }} transition={{ duration: 0.12 }} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, color: sideColor, display: 'inline-block' }}>{rateLabel} → {side?.toUpperCase()}</motion.span>
              : <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-mono)', display: 'inline-block' }}>← drag to stream →</motion.span>
            }
          </AnimatePresence>
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: side === 'yes' ? '#00ff87' : 'rgba(255,255,255,0.25)', transition: 'color 0.2s', fontFamily: 'var(--font-mono)' }}>YES</span>
      </div>
      <div ref={trackRef} onClick={handleTrackClick} style={{ position: 'relative', height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 2, cursor: disabled ? 'not-allowed' : 'pointer' }}>
        {trackFills}
      </div>
    </div>
  )
}
