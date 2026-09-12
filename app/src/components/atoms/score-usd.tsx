import NumberFlow from '@number-flow/react'
import type { CSSProperties } from 'react'

import { useLiveCounter } from '#/hooks/use-live-counter'

/**
 * A USD amount that rolls like a scoreboard when it changes (via NumberFlow). Pass `live` plus
 * `ratePerSec` (the SDK's real per-second growth) for a value that streams in continuously (a vault
 * pool) — it projects `value + ratePerSec × elapsed` between the 3s polls so the digits keep ticking
 * up with the true slope instead of jumping once per poll. Omit `live` for discrete balances (a wallet).
 */
export function ScoreUSD({
  value,
  live = false,
  ratePerSec,
  decimals = 2,
  className,
  style,
}: {
  value: number
  live?: boolean
  ratePerSec?: number
  decimals?: number
  className?: string
  style?: CSSProperties
}) {
  const v = useLiveCounter(value, { live, ratePerSec })
  return (
    <NumberFlow
      className={className}
      style={style}
      value={Number.isFinite(v) ? v : 0}
      format={{
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }}
      willChange={live}
    />
  )
}
