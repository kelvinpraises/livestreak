import { expect, it } from 'vitest'
import { formatLvst } from '../src/utils/format'

it('smoke', () => {
  expect(true).toBe(true)
})

it('formatLvst outputs $LVST', () => {
  expect(formatLvst(1250)).toContain('$LVST')
})
