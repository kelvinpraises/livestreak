import { describe, expect, it } from 'vitest'
import type { FunctionDescriptor } from '@livestreak/schema'
import { coerceArgs, coerceField } from '../src/utils/auto-form-schema'

describe('auto-form coercion', () => {
  it('coerces scalars and reports required errors', () => {
    expect(coerceField({ type: 'number', required: true }, '42')).toEqual({ value: 42 })
    expect(coerceField({ type: 'integer' }, '3.5').error).toBeDefined()
    expect(coerceField({ type: 'string', required: true }, '   ').error).toBe('Required')
    expect(coerceField({ type: 'enum', required: true, values: ['a', 'b'] }, 'c').error).toBeDefined()
    expect(coerceField({ type: 'boolean' }, 'on')).toEqual({ value: true })
  })

  it('merges prefilled target ids and hides them from validation', () => {
    const schema: FunctionDescriptor['inputSchema'] = {
      type: 'object',
      properties: [
        { name: 'amountUSDC', help: '', value: { type: 'number', required: true } },
        { name: 'vaultId', help: '', value: { type: 'string', required: true } },
      ],
    }
    const res = coerceArgs(schema, { amountUSDC: '100' }, { vaultId: 'vault-01' })
    expect(res.ok).toBe(true)
    expect(res.values).toEqual({ vaultId: 'vault-01', amountUSDC: 100 })
  })
})
