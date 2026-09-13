import { describe, expect, it } from 'vitest'
import { formatRate } from '../src/utils/format'

describe('formatRate', () => {
  it('formats a per-minute rate', () => {
    expect(formatRate(1.5)).toBe('$1.50/min')
  })

  it('shows — below one cent', () => {
    expect(formatRate(0)).toBe('—')
  })

  // Regression: a position with no active lane has an undefined rate. The formatter must render "—"
  // rather than call undefined.toFixed() — that crash took down the whole /stream/tech-1 page.
  it('shows — for undefined / NaN instead of throwing', () => {
    expect(formatRate(undefined as unknown as number)).toBe('—')
    expect(formatRate(Number.NaN)).toBe('—')
  })
})
