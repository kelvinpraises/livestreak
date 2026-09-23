import { useEffect, useRef, useState } from 'react'

export interface SteppedValueOptions {
  /** Step forward only while this position is actively streaming. Held/paused/depleted → shows the real value. */
  readonly live?: boolean
  /** Hard ceiling the shown value never exceeds (e.g. 100 for a share-%). It can still fall below it. */
  readonly max?: number
}

// Distinct dwell times (seconds) between steps — pick from this set, never repeating the last, so the
// cadence reads as organic rather than a metronome.
const STEP_SECONDS = [3, 4, 5, 6] as const
// The FIRST step fires fast so a freshly-entered position shows its real value right away instead of
// sitting on a stale one for a full dwell.
const FIRST_STEP_MS = 900

/**
 * A polled value revealed in DISCRETE steps. Every 3–6s (a random dwell, never repeating the last) it SNAPS
 * to whatever the value REALLY is right now and HOLDS until the next step — no projection, no guessing. The
 * value it shows is the real one the SDK reports (which, for shares, is the true live bonding-curve accrual);
 * the UI never invents an in-between number, so it can't bounce (87.5 → 87 → jump). `max` clamps it (a
 * share-% never reads above 100). Not streaming → the real value directly.
 */
export function useSteppedValue(target: number, opts: SteppedValueOptions = {}): number {
  const { live = false, max } = opts
  const applyMax = (n: number): number => (max !== undefined ? Math.min(max, n) : n)
  const targetRef = useRef(target)
  targetRef.current = target
  const lastStep = useRef(0)
  const [display, setDisplay] = useState(applyMax(target))

  // Step loop — runs while live, keyed ONLY on `live` so a poll can't tear it down and restart the timer.
  // Each step reads the always-fresh `targetRef` and shows exactly that (clamped). No rate, no projection.
  useEffect(() => {
    if (!live) return
    let timer: ReturnType<typeof setTimeout>
    const nextDelay = (): number => {
      const choices = STEP_SECONDS.filter((s) => s !== lastStep.current)
      const s = choices[Math.floor(Math.random() * choices.length)]!
      lastStep.current = s
      return s * 1000
    }
    const step = (): void => {
      setDisplay(applyMax(targetRef.current))
      timer = setTimeout(step, nextDelay())
    }
    timer = setTimeout(step, FIRST_STEP_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  return live ? display : applyMax(target)
}
