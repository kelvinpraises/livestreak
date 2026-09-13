import { describe, expect, it } from 'vitest'
import { bridgeActionScope, type FunctionDescriptor } from '@livestreak/schema'
import { coerceArgs, coerceField } from '../src/utils/auto-form-schema'
import { buildTree } from '../src/components/organisms/function-tree'
import { callResultBadge } from '../src/components/template/remote-console'

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

describe('call result badge', () => {
  it('surfaces the minted tokenId as the confirmation', () => {
    expect(callResultBadge({ ok: true, result: { txId: '0xabc', tokenId: '7' } })).toEqual({
      text: '✓ token #7',
      ok: true,
    })
  })

  it('falls back to a plain sent cue when there is no outcome payload', () => {
    expect(callResultBadge({ ok: true })).toEqual({ text: '✓ sent', ok: true })
    expect(callResultBadge({ ok: true, result: { txId: '0xabc' } })).toEqual({ text: '✓ sent', ok: true })
  })

  it('shows the relay error on failure', () => {
    expect(callResultBadge({ ok: false, error: 'denied' })).toEqual({ text: '✗ denied', ok: false })
    expect(callResultBadge({ ok: false })).toEqual({ text: '✗ failed', ok: false })
  })
})

describe('function tree visibility', () => {
  const optionsTreeFixture: readonly FunctionDescriptor[] = [
    {
      id: 'options.config.configure',
      package: 'options',
      name: 'configure',
      label: 'Configure',
      scope: bridgeActionScope,
      nodeKind: 'group',
      disabled: false,
      visible: true,
    },
    {
      id: 'options.action.fundVault',
      package: 'options',
      parentId: 'options.config.configure',
      name: 'fundVault',
      label: 'Fund vault',
      scope: 'bridge:action:fundVault',
      nodeKind: 'action',
      disabled: false,
      visible: true,
    },
    {
      id: 'options.action.hiddenProbe',
      package: 'options',
      parentId: 'options.config.configure',
      name: 'hiddenProbe',
      label: 'Hidden',
      scope: 'bridge:action:hiddenProbe',
      nodeKind: 'action',
      disabled: false,
      visible: false,
    },
  ]

  it('omits visible===false nodes from the rendered tree', () => {
    const { roots, childrenOf } = buildTree(optionsTreeFixture)
    const collectIds = (nodes: readonly FunctionDescriptor[]): string[] => {
      const out: string[] = []
      for (const n of nodes) {
        out.push(n.id)
        const kids = childrenOf.get(n.id) ?? []
        out.push(...collectIds(kids))
      }
      return out
    }
    const ids = collectIds(roots)
    expect(ids).not.toContain('options.action.hiddenProbe')
    expect(ids).toContain('options.action.fundVault')
  })
})
