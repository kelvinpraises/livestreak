import { describe, expect, it } from 'vitest'
import { bridgeActionScope, type CallActionEnvelope, type FunctionDescriptor } from '@livestreak/schema'
import { coerceArgs, coerceField } from '../src/utils/auto-form-schema'
import { LocalMockTransport } from '../src/utils/remote-transport'
import { demoMockSeed } from '../src/utils/remote-mock-seed'

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

describe('LocalMockTransport (relayed call end-to-end)', () => {
  it('rejects a bad password', async () => {
    const t = new LocalMockTransport(demoMockSeed)
    await expect(t.redeem('demo', 'wrong')).rejects.toThrow()
  })

  it('only advertises in-scope functions, relays a call, and patches the board', async () => {
    const t = new LocalMockTransport(demoMockSeed)
    let functions: readonly FunctionDescriptor[] = []
    let board: Record<string, unknown> = {}
    t.onFunctions((f) => (functions = f))
    t.onPatch((b) => (board = b))

    const session = await t.redeem('demo', 'streak')
    expect(session.grant.scopes).toContain(bridgeActionScope)
    await t.connect(session)

    // pauseMarket (bridge:admin:market) must be filtered out; the 3 action fns remain.
    const names = functions.map((f) => f.name)
    expect(names).toContain('fundVault')
    expect(names).not.toContain('pauseMarket')

    const before = (board['vault-01'] as { tvlUSDC: number }).tvlUSDC
    const envelope: CallActionEnvelope = {
      scope: bridgeActionScope,
      action: 'fundVault',
      args: { vaultId: 'vault-01', side: 'yes', amountUSDC: 500 },
    }
    const res = await t.send(envelope)
    expect(res.ok).toBe(true)
    expect((board['vault-01'] as { tvlUSDC: number }).tvlUSDC).toBe(before + 500)
  })

  it('refuses an out-of-scope action over the wire', async () => {
    const t = new LocalMockTransport(demoMockSeed)
    const session = await t.redeem('demo', 'streak')
    await t.connect(session)
    const res = await t.send({ scope: bridgeActionScope, action: 'pauseMarket', args: {} })
    expect(res.ok).toBe(false)
  })
})
