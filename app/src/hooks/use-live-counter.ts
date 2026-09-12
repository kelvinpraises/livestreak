import { useEffect, useRef, useState } from 'react'

export interface LiveCounterOptions {
  /** Animate continuously between polls (for a value that streams in, like a vault pool). */
  readonly live?: boolean
  /**
   * Real growth rate in display units per SECOND, sourced from the options SDK (the on-chain
   * sideRate) — NOT estimated in the UI. When live, the counter ticks `target + ratePerSec × elapsed`
   * since the last poll, the same segMath the SDK projects with, so it lands on the next poll's value
   * instead of guessing. Rate 0 (no active stream) just holds at target.
   */
  readonly ratePerSec?: number
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const toCents = (n: number): number => Math.round(n * 100) / 100

/**
 * Smoothly ticks a polled value forward using the REAL per-second rate the SDK reports. The app only
 * learns the pool every ~3s, so the raw number jumps; between polls this projects `base + rate × Δt`
 * from the last reading. Because `rate` is the true on-chain sideRate (refreshed every poll), this can
 * never run away: when streaming stops the next poll reports rate 0 and the display pins at `base`, and
 * the most it can ever drift before a correction is one poll-interval of real growth.
 *
 * (An earlier version ESTIMATED the rate from poll-to-poll deltas — which conflated discrete bets with
 * streaming and had no ceiling, so it climbed past the real pool forever. This uses the SDK's rate.)
 */
export function useLiveCounter(target: number, opts: LiveCounterOptions = {}): number {
  const { live = false, ratePerSec = 0 } = opts
  const anchor = useRef({ base: target, rate: 0, at: now() })
  const [display, setDisplay] = useState(target)

  // Re-anchor on every poll (target change) AND whenever the real rate changes — including the rate
  // dropping to 0 when streaming stops, which pins the display at `target` so it can never run away.
  useEffect(() => {
    anchor.current = { base: target, rate: live ? Math.max(0, ratePerSec) : 0, at: now() }
    if (!live) setDisplay(target)
  }, [target, ratePerSec, live])

  useEffect(() => {
    if (!live) return
    let raf = 0
    let lastFrame = 0
    const loop = (ts: number) => {
      if (ts - lastFrame >= 80) {
        lastFrame = ts
        const a = anchor.current
        // setState bails out when the cents-rounded value is unchanged, so NumberFlow only re-rolls a
        // digit when the value actually moves rather than ~12×/sec.
        setDisplay(toCents(a.base + a.rate * ((now() - a.at) / 1000)))
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [live])

  return live ? display : target
}
