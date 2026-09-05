import { useRef, useState, useLayoutEffect } from 'react'
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion'
import type { OptionsFunctionView } from '@livestreak/options'

import { shareStringToNumber, usdcStringToNumber } from '#/utils/options'
import { OptionsActionButton } from '#/components/atoms/options-action-button'

const MAX_RATE = 10
const THUMB_R = 12
const THUMB_NEUTRAL = '#7c8595'

interface AccrualPreviewView {
  projectedShares: number
  valueUsdc: number
  sharesPerSec: number
}

interface Props {
  vaultId: string
  initialSide?: 'yes' | 'no' | null
  initialRate?: number
  disabled?: boolean
  compact?: boolean
  onStream?: (side: 'yes' | 'no' | null, rate: number) => void
  fundYes?: OptionsFunctionView
  fundNo?: OptionsFunctionView
  stopFn?: OptionsFunctionView
  activeFundedSide?: 'yes' | 'no'
  onStopFunding?: () => void | Promise<unknown>
  sharePriceYes?: number
  sharePriceNo?: number
  accrualPreview?: AccrualPreviewView | null
  previewLoading?: boolean
  showPreview?: boolean
}

export function StreamSlider({
  initialSide = null,
  initialRate = 0,
  disabled = false,
  compact = false,
  onStream,
  fundYes,
  fundNo,
  stopFn,
  activeFundedSide,
  onStopFunding,
  sharePriceYes,
  sharePriceNo,
  accrualPreview,
  previewLoading = false,
  showPreview = false,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const didInitX = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const [side, setSide] = useState<'yes' | 'no' | null>(activeFundedSide ?? initialSide)
  const [rate, setRate] = useState(initialRate)
  const x = useMotionValue(0)

  const yesAllowed = fundYes ? !fundYes.disabled : true
  const noAllowed = fundNo ? !fundNo.disabled : true
  const sliderDisabled = disabled || (activeFundedSide !== undefined && !!stopFn && !stopFn.disabled)

  function getHalfWidth() { return Math.max(1, (trackRef.current?.clientWidth ?? 280) / 2 - THUMB_R) }

  useLayoutEffect(() => {
    if (activeFundedSide) {
      const sign = activeFundedSide === 'no' ? -1 : 1
      const offset = sign * (Math.min(Math.max(rate, 0.8), MAX_RATE) / MAX_RATE) * getHalfWidth()
      x.set(offset)
      setSide(activeFundedSide)
      return
    }
    if (didInitX.current) return
    didInitX.current = true
    if (!initialSide || initialRate <= 0) return
    const sign = initialSide === 'no' ? -1 : 1
    const offset = sign * (Math.min(initialRate, MAX_RATE) / MAX_RATE) * getHalfWidth()
    x.set(offset)
  })

  function updateFromX(xVal: number) {
    if (sliderDisabled) return
    const hw = getHalfWidth(), pct = Math.max(-1, Math.min(1, xVal / hw))
    const newRate = Math.abs(pct) * MAX_RATE
    let newSide: 'yes' | 'no' | null = pct > 0.05 ? 'yes' : pct < -0.05 ? 'no' : null
    if (newSide === 'yes' && !yesAllowed) newSide = null
    if (newSide === 'no' && !noAllowed) newSide = null
    setRate(newRate); setSide(newSide); onStream?.(newSide, newRate)
  }

  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    if (sliderDisabled) return
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const clickX = e.clientX - rect.left - rect.width / 2
    animate(x, clickX, { type: 'spring', stiffness: 500, damping: 30 })
    updateFromX(clickX)
  }

  const rateLabel = rate > 0.01 ? `$${rate.toFixed(2)}/min` : null
  const sideColor = side === 'yes' ? '#00ff87' : side === 'no' ? '#ff2d78' : 'rgba(255,255,255,0.2)'
  const thumbBg = side === 'yes' ? '#00ff87' : side === 'no' ? '#ff2d78' : THUMB_NEUTRAL
  const sideDisabledReason = side === 'yes'
    ? fundYes?.disabledReason
    : side === 'no'
      ? fundNo?.disabledReason
      : undefined
  const sharePrice = side === 'yes' ? sharePriceYes : side === 'no' ? sharePriceNo : undefined

  const trackFills = (
    <>
      <div style={{ position: 'absolute', right: '50%', top: 0, height: '100%', width: '50%', background: 'linear-gradient(90deg, rgba(255,45,120,0.3), #ff2d78)', borderRadius: 2, transform: `scaleX(${side === 'no' ? rate / MAX_RATE : 0})`, transformOrigin: 'right', transition: 'transform 0.05s', opacity: noAllowed ? 1 : 0.35 }} />
      <div style={{ position: 'absolute', left: '50%', top: 0, height: '100%', width: '50%', background: 'linear-gradient(90deg, #00ff87, rgba(0,255,135,0.3))', borderRadius: 2, transform: `scaleX(${side === 'yes' ? rate / MAX_RATE : 0})`, transformOrigin: 'left', transition: 'transform 0.05s', opacity: yesAllowed ? 1 : 0.35 }} />
      <motion.div
        drag={sliderDisabled ? false : 'x'} dragMomentum={false} dragConstraints={trackRef} dragElastic={0.05}
        style={{ x, position: 'absolute', top: -(THUMB_R - 2), left: `calc(50% - ${THUMB_R}px)`, width: THUMB_R * 2, height: THUMB_R * 2, borderRadius: '50%', background: thumbBg, transition: 'background 0.2s', border: '2px solid rgba(0,0,0,0.3)', boxShadow: isDragging ? `0 0 20px ${sideColor}40` : '0 2px 8px rgba(0,0,0,0.5)', cursor: sliderDisabled ? 'not-allowed' : 'grab', zIndex: 2, touchAction: 'none' }}
        onDrag={() => updateFromX(x.get())}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={() => {
          setIsDragging(false)
          if (activeFundedSide) return
          if (Math.abs(x.get()) < getHalfWidth() * 0.05) {
            animate(x, 0, { type: 'spring', stiffness: 500, damping: 30 })
            setSide(null); setRate(0); onStream?.(null, 0)
          }
        }}
        whileTap={{ scale: sliderDisabled ? 1 : 1.1 }}
      />
      <div style={{ position: 'absolute', left: '50%', top: -2, width: 1, height: 8, background: 'rgba(255,255,255,0.15)', transform: 'translateX(-50%)', pointerEvents: 'none' }} />
    </>
  )

  const previewBlock = showPreview && (
    <div style={{ marginTop: compact ? 6 : 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {sharePrice !== undefined && (
        <p className="mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', margin: 0 }}>
          Next share ~${sharePrice.toFixed(4)} USDC
        </p>
      )}
      {side && rate > 0.01 && (
        <p className="mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', margin: 0 }}>
          {previewLoading
            ? 'Projecting accrual…'
            : accrualPreview
              ? `~${accrualPreview.projectedShares.toFixed(2)} shares / min → $${accrualPreview.valueUsdc.toFixed(2)} over 60s`
              : 'Adjust rate to preview accrual'}
        </p>
      )}
    </div>
  )

  const stopBlock = activeFundedSide && stopFn && onStopFunding && (
    <div style={{ marginTop: compact ? 6 : 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span className="mono" style={{ fontSize: 10, color: activeFundedSide === 'yes' ? '#00ff87' : '#ff2d78' }}>
        Streaming {activeFundedSide.toUpperCase()}
      </span>
      <OptionsActionButton label="Stop" fn={stopFn} onAction={onStopFunding} variant="ghost" compact />
    </div>
  )

  const reasonBlock = side && sideDisabledReason && (
    <p style={{ fontSize: 9, color: 'rgba(255,122,0,0.85)', margin: compact ? '4px 0 0' : '6px 0 0' }}>{sideDisabledReason}</p>
  )

  if (compact) {
    return (
      <div style={{ userSelect: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span title={fundNo?.disabledReason} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: side === 'no' ? '#ff2d78' : noAllowed ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.12)', fontFamily: 'var(--font-mono)', flexShrink: 0, transition: 'color 0.2s' }}>NO</span>
          <div ref={trackRef} onClick={handleTrackClick} style={{ position: 'relative', height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 2, cursor: sliderDisabled ? 'not-allowed' : 'pointer', flex: 1 }}>
            {trackFills}
          </div>
          <span title={fundYes?.disabledReason} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: side === 'yes' ? '#00ff87' : yesAllowed ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.12)', fontFamily: 'var(--font-mono)', flexShrink: 0, transition: 'color 0.2s' }}>YES</span>
        </div>
        {reasonBlock}
        {stopBlock}
        {previewBlock}
      </div>
    )
  }

  return (
    <div style={{ userSelect: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span title={fundNo?.disabledReason} style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: side === 'no' ? '#ff2d78' : noAllowed ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)', transition: 'color 0.2s', fontFamily: 'var(--font-mono)' }}>NO</span>
        <div style={{ textAlign: 'center', minHeight: 16 }}>
          <AnimatePresence mode="wait" initial={false}>
            {rateLabel
              ? <motion.span key="rate" initial={{ opacity: 0, y: -4, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: 4, filter: 'blur(4px)' }} transition={{ duration: 0.12 }} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, color: sideColor, display: 'inline-block' }}>{rateLabel} → {side?.toUpperCase()}</motion.span>
              : <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-mono)', display: 'inline-block' }}>← drag to stream →</motion.span>
            }
          </AnimatePresence>
        </div>
        <span title={fundYes?.disabledReason} style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: side === 'yes' ? '#00ff87' : yesAllowed ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)', transition: 'color 0.2s', fontFamily: 'var(--font-mono)' }}>YES</span>
      </div>
      <div ref={trackRef} onClick={handleTrackClick} style={{ position: 'relative', height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 2, cursor: sliderDisabled ? 'not-allowed' : 'pointer' }}>
        {trackFills}
      </div>
      {reasonBlock}
      {stopBlock}
      {previewBlock}
    </div>
  )
}

export function mapAccrualPreview(preview: {
  projectedShares: string
  valueUSDC: string
  sharesPerSec: string
} | null): AccrualPreviewView | null {
  if (!preview) return null
  return {
    projectedShares: shareStringToNumber(preview.projectedShares),
    valueUsdc: usdcStringToNumber(preview.valueUSDC),
    sharesPerSec: shareStringToNumber(preview.sharesPerSec),
  }
}
