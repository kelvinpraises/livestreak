import NumberFlow, { type Format } from '@number-flow/react'
import type { CSSProperties } from 'react'

import { useSteppedValue } from '#/hooks/use-stepped-value'

/**
 * A number for a streaming position's shares / %. It updates in DISCRETE steps every 3–6s, snapping to the
 * REAL current value and holding between — NumberFlow rolls the digits on each jump. No projection: the value
 * is exactly what the SDK reports, so it never bounces. `max` caps it (100 for a share-%). Held / paused /
 * depleted (live=false) → the real value, no ticking.
 */
export function ScoreNumber({
  value,
  live = false,
  max,
  format,
  className,
  style,
}: {
  value: number
  live?: boolean
  max?: number
  format?: Format
  className?: string
  style?: CSSProperties
}) {
  const v = useSteppedValue(value, { live, max })
  return (
    <NumberFlow
      className={className}
      style={style}
      value={Number.isFinite(v) ? v : 0}
      format={format}
      willChange={live}
    />
  )
}
