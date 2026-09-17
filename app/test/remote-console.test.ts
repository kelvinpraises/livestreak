import { describe, expect, it } from 'vitest'
import { bridgeActionScope, type FunctionDescriptor } from '@livestreak/schema'
import { coerceArgs, coerceField } from '../src/utils/auto-form-schema'
import { buildTree, deriveSectionLabel } from '../src/components/organisms/function-tree'
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

describe('function tree hierarchy (observe orphan-parented actions)', () => {
  // Observe emits actions whose parentId names a section (observe.capture.file, observe.market, …) but
  // never emits a group node for it. The tree builder must synthesize those sections instead of flattening
  // every action into one blob under the package root.
  const action = (
    id: string,
    parentId: string,
    order: number,
    visible = true
  ): FunctionDescriptor => ({
    id,
    parentId,
    package: 'observe',
    name: id.split('.').pop() ?? id,
    label: id.split('.').pop() ?? id,
    scope: `${bridgeActionScope}:x` as FunctionDescriptor['scope'],
    nodeKind: 'action',
    disabled: false,
    visible,
    order,
  })

  const observeFixture: readonly FunctionDescriptor[] = [
    action('observe.system.run.prepare', 'observe.system.run', 0),
    action('observe.system.run.start', 'observe.system.run', 1),
    action('observe.capture.file.configure', 'observe.capture.file', 5),
    action('observe.sink.live.configure', 'observe.sink.live', 6),
    action('observe.market.register', 'observe.market', 10),
    action('observe.market.goLive', 'observe.market', 11),
    action('observe.market.hiddenClose', 'observe.market', 12, false),
  ]

  it('groups orphan-parented actions into synthesized sections in child order', () => {
    const { roots, childrenOf } = buildTree(observeFixture)

    // Each distinct parentId becomes one synthesized group root; roots ordered by their first child.
    expect(roots.map((r) => r.id)).toEqual([
      'observe.system.run',
      'observe.capture.file',
      'observe.sink.live',
      'observe.market',
    ])
    expect(roots.every((r) => r.nodeKind === 'group')).toBe(true)

    // Children nest under their synthesized parent, sorted by order.
    expect((childrenOf.get('observe.system.run') ?? []).map((c) => c.id)).toEqual([
      'observe.system.run.prepare',
      'observe.system.run.start',
    ])
    expect((childrenOf.get('observe.market') ?? []).map((c) => c.id)).toEqual([
      'observe.market.register',
      'observe.market.goLive',
    ])
  })

  it('drops hidden children from the synthesized section', () => {
    const { childrenOf } = buildTree(observeFixture)
    const marketKids = (childrenOf.get('observe.market') ?? []).map((c) => c.id)
    expect(marketKids).not.toContain('observe.market.hiddenClose')
  })

  it('keeps a truly parentless action at the package root (no synthetic group)', () => {
    const loose: FunctionDescriptor = {
      id: 'observe.loose',
      package: 'observe',
      name: 'loose',
      label: 'Loose',
      scope: bridgeActionScope,
      nodeKind: 'action',
      disabled: false,
      visible: true,
      order: 0,
    }
    const { roots } = buildTree([loose])
    expect(roots.map((r) => r.id)).toEqual(['observe.loose'])
    expect(roots[0].nodeKind).toBe('action')
  })

  it('derives readable section labels, dropping package + system qualifiers', () => {
    expect(deriveSectionLabel('observe.capture.file')).toBe('Capture · File')
    expect(deriveSectionLabel('observe.sink.live')).toBe('Sink · Live')
    expect(deriveSectionLabel('observe.system.run')).toBe('Run')
    expect(deriveSectionLabel('observe.market')).toBe('Market')
  })
})
