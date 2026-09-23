import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { OptionsVault } from '@livestreak/options'
import { useVaultView } from '#/hooks/use-vault-views'
import { formatMultiplier } from '#/utils/format'

interface Props {
  vault: OptionsVault
  onClickCard?: (vaultId: string) => void
}

const CARD_W = 340
const CARD_H = 42
const DRIFT_SPEED = 0.3 // px per frame, right → left
const VERTICAL_WOBBLE = 0.4

/**
 * NikoNiko-style read-only card that drifts across the video area.
 * Shows the question + multiplier. Hovering pauses drift and shows full title.
 * Clicking opens the vault detail in the right panel.
 */
export function NikoNikoCard({ vault, onClickCard }: Props) {
  const view = useVaultView(vault.vaultId)
  const yesTotal = view.poolYes ?? Number(vault.pools.yes)
  const noTotal = view.poolNo ?? Number(vault.pools.no)
  const multiplier = view.multiplier ?? (yesTotal > 0 ? (yesTotal + noTotal) / yesTotal : 1)
  const ref = useRef<HTMLDivElement>(null)
  // Original organic drift: right → left with a little vertical wobble, bouncing off top/bottom.
  const posRef = useRef({ x: 0, y: 0, dx: -DRIFT_SPEED, dy: 0 })
  const rafRef = useRef<number>(0)
  const hoveredRef = useRef(false)
  const textRef = useRef<HTMLSpanElement>(null)
  const [ready, setReady] = useState(false)
  const [enterDelay, setEnterDelay] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)

  const isHot = vault.status === 'hot'

  // Position — random seed, initialized ONCE on mount. Deliberately independent of the vault COUNT: the
  // ONLY thing the earlier bug fix changed is that an added/removed vault no longer re-inits every card
  // (which reset the whole field — a jarring CLS). The motion itself is the original organic drift.
  useEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    const pw = parent.clientWidth
    const ph = parent.clientHeight

    posRef.current = {
      x: pw * 0.15 + Math.random() * pw * 0.8,          // random start across the pane
      y: 8 + Math.random() * Math.max(0, ph - CARD_H - 16),
      dx: -(DRIFT_SPEED + Math.random() * 0.2),         // right → left, slight per-card variance
      dy: (Math.random() - 0.5) * VERTICAL_WOBBLE,
    }
    setEnterDelay(Math.random() * 0.4)                  // random fade-in stagger
    setReady(true)
    // Mount-once by design (must NOT re-init on count changes). Stable per vaultId key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Drift loop — depends only on `ready`, so a changing vault count never tears it down. Original motion:
  // drift right → left with a little vertical wobble, bounce off top/bottom, respawn from the right edge.
  useEffect(() => {
    if (!ready) return
    function tick() {
      const el = ref.current
      const p = el?.parentElement
      if (!el || !p) return
      if (!hoveredRef.current) {
        const pw = p.clientWidth
        const ph = p.clientHeight
        const pos = posRef.current
        pos.x += pos.dx
        pos.y += pos.dy
        if (pos.x < -CARD_W - 10) {
          pos.x = pw + 10
          pos.y = 8 + Math.random() * Math.max(0, ph - CARD_H - 16)
        }
        if (pos.y < 4 || pos.y > ph - CARD_H - 4) {
          pos.dy = -pos.dy
          pos.y = Math.min(Math.max(4, pos.y), ph - CARD_H - 4)
        }
      }
      el.style.transform = `translate3d(${posRef.current.x}px, ${posRef.current.y}px, 0)`
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [ready])

  const accentColor = isHot ? 'rgba(255,45,120,0.55)' : 'rgba(0,255,135,0.4)'
  const textColor = isHot ? '#ff7a00' : '#00ff87'

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, filter: 'blur(4px)' }}
      animate={{ opacity: ready ? 1 : 0, filter: ready ? 'blur(0px)' : 'blur(4px)' }}
      exit={{ opacity: 0, filter: 'blur(4px)' }}
      transition={{ duration: 0.25, delay: enterDelay }}
      onClick={() => onClickCard?.(vault.vaultId)}
      onMouseEnter={() => { hoveredRef.current = true; setHovered(true); if (textRef.current) setIsTruncated(textRef.current.scrollWidth > textRef.current.clientWidth) }}
      onMouseLeave={() => { hoveredRef.current = false; setHovered(false) }}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: CARD_W,
        height: CARD_H,
        background: hovered ? 'rgba(13,13,28,0.85)' : 'rgba(13,13,28,0.55)',
        backdropFilter: 'blur(8px)',
        border: `1px solid ${hovered ? (isHot ? 'rgba(255,45,120,0.7)' : 'rgba(0,255,135,0.6)') : accentColor}`,
        borderRadius: 10,
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        pointerEvents: 'auto',
        boxShadow: hovered
          ? `0 0 24px ${accentColor}, 0 4px 16px rgba(0,0,0,0.5)`
          : `0 0 12px ${accentColor}, 0 2px 8px rgba(0,0,0,0.4)`,
        willChange: 'transform',
        zIndex: hovered ? 100 : 15,
        transition: 'background 0.15s, border-color 0.15s, box-shadow 0.2s',
      }}
    >
      <span ref={textRef} style={{
        fontFamily: 'var(--font-display)',
        fontSize: 12,
        fontWeight: 600,
        color: hovered ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.75)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        flex: 1,
        lineHeight: 1.2,
        letterSpacing: '0.01em',
        transition: 'color 0.15s',
      }}>
        {vault.question}
      </span>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        fontWeight: 700,
        color: textColor,
        flexShrink: 0,
        textShadow: `0 0 12px ${accentColor}`,
      }}>
        {formatMultiplier(multiplier)}
      </span>

      {/* Hover tooltip — small tooltip with arrow */}
      {hovered && isTruncated && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 8px)',
          left: 12,
          maxWidth: 260,
          background: 'rgba(20,20,35,0.96)',
          borderRadius: 6,
          padding: '6px 10px',
          pointerEvents: 'none',
          zIndex: 200,
          boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
        }}>
          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.85)',
            lineHeight: 1.4,
            margin: 0,
            whiteSpace: 'normal',
          }}>
            {vault.question}
          </p>
          {/* Arrow */}
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 16,
            width: 0, height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '5px solid rgba(20,20,35,0.96)',
          }} />
        </div>
      )}
    </motion.div>
  )
}
