// Golden test for the bookmaker mapper: wire-shaped functions[] + BookmakerPanelView board →
// ConsoleModel, held to the same contract invariants the fixtures pass. Function shapes mirror
// packages/bookmaker/src/bridge/panel/descriptors.ts (projectBookmakerDescriptors).

import { describe, expect, it } from 'vitest'
import type { FunctionDescriptor } from '@livestreak/schema'
import { mapBookmaker } from '../src/utils/console-map/map-bookmaker'
import type { PendingCall } from '../src/utils/console-map/types'
import { consoleModelViolations } from './helpers/console-invariants'

const MARKET = '0x2669e60cf22c8f8bd2d1a9f7203e59a921bd66c96626e0864a5d1e4478d34ed8'
const VAULT_1 = '0x39e9aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22aa33bb44cc55'

const wireFunctions = (configured: boolean): FunctionDescriptor[] => [
  { id: 'bookmaker.root', package: 'bookmaker', name: 'bookmaker', label: 'Bookmaker', scope: 'bridge:controls:read', nodeKind: 'group', disabled: false, visible: true },
  { id: 'bookmaker.config.configure', parentId: 'bookmaker.root', package: 'bookmaker', name: 'configure', label: 'Configure bookmaker', scope: 'bridge:action:configure', nodeKind: 'action', disabled: false, visible: true },
  { id: 'bookmaker.config.close', parentId: 'bookmaker.root', package: 'bookmaker', name: 'close', label: 'Close', scope: 'bridge:action:close', nodeKind: 'action', disabled: false, visible: true },
  {
    id: 'bookmaker.root.action.createVault',
    parentId: 'bookmaker.root',
    package: 'bookmaker',
    name: 'createVault',
    label: 'Create vault',
    scope: 'bridge:action:createVault',
    target: { kind: 'vault', ...(configured ? { marketId: MARKET } : {}) },
    nodeKind: 'action',
    disabled: !configured,
    visible: configured,
    ...(configured ? {} : { disabledReason: 'No market context' }),
  },
]

const boardWith = (vaults: number) => ({
  runtimeId: 'remote-abc123def',
  marketId: MARKET,
  writeIntents: [],
  completedVaultCreations: Array.from({ length: vaults }, (_, i) => ({
    intent: { question: `Question ${i + 1}?`, creatorSide: 'yes' },
    result: { txId: `0xtx${i}`, vaultId: i === 0 ? VAULT_1 : `0xvault${i}` },
  })),
  updatedAtMs: 1_700_000_000_000,
})

const NONE: ReadonlyMap<string, PendingCall> = new Map()

describe('mapBookmaker', () => {
  it('unconfigured: session-only desk, Add market hot, do-card pointing at session', () => {
    const model = mapBookmaker({
      functions: wireFunctions(false),
      board: { runtimeId: 'r', marketId: '', writeIntents: [], completedVaultCreations: [], updatedAtMs: 1 },
      pending: NONE,
    })
    expect(consoleModelViolations(model)).toEqual([])
    expect(model.things.map((t) => t.kind)).toEqual(['session', 'state'])
    const addMarket = model.focus.session?.verbs.find((v) => v.name === 'Add market')
    expect(addMarket).toMatchObject({ state: 'ready', hot: true, callRef: 'bookmaker.config.configure' })
    expect(model.attention[0]).toMatchObject({ targetId: 'session', tone: 'do' })
    expect(model.defaultFocusId).toBe('session')
  })

  it('configured with vaults: market + vault things, Create vault carries callRef and wire args', () => {
    const model = mapBookmaker({ functions: wireFunctions(true), board: boardWith(2), pending: NONE })
    expect(consoleModelViolations(model)).toEqual([])

    const market = model.things.find((t) => t.kind === 'market')
    expect(market).toMatchObject({ id: `market:${MARKET}`, note: '2 vaults', tone: 'ok' })
    const vaults = model.things.filter((t) => t.kind === 'vault')
    expect(vaults.map((v) => v.label)).toEqual(['Question 1?', 'Question 2?'])
    expect(vaults[0]).toMatchObject({ id: `vault:${VAULT_1}`, parentId: `market:${MARKET}` })

    const card = model.focus[`market:${MARKET}`]
    const create = card?.verbs.find((v) => v.name === 'Create vault')
    expect(create).toMatchObject({ state: 'ready', hot: true, callRef: 'bookmaker.root.action.createVault' })
    expect(create?.fields?.map((f) => f.arg ?? f.name)).toEqual([
      'question',
      'creatorSide',
      'creatorStake',
      'seedRate',
    ])
    const closeOut = card?.verbs.find((v) => v.name === 'Close out')
    expect(closeOut).toMatchObject({ state: 'guarded', callRef: 'bookmaker.config.close' })
    expect(closeOut?.consequence).toContain('2 vaults')

    // Seeded market → no seed do-card.
    expect(model.attention.find((a) => a.title.startsWith('Seed'))).toBeUndefined()
  })

  it('configured with 0 vaults: warn tone justified by the seed do-card', () => {
    const model = mapBookmaker({ functions: wireFunctions(true), board: boardWith(0), pending: NONE })
    expect(consoleModelViolations(model)).toEqual([])
    expect(model.things.find((t) => t.kind === 'market')?.tone).toBe('warn')
    expect(model.attention[0]).toMatchObject({ targetId: `market:${MARKET}`, tone: 'do' })
  })

  it('pending overlay: busy renders busy, failed carries the reason and an err card', () => {
    const busy = new Map<string, PendingCall>([
      ['bookmaker.root.action.createVault', { phase: 'busy', startedAt: 1 }],
    ])
    const busyModel = mapBookmaker({ functions: wireFunctions(true), board: boardWith(1), pending: busy })
    expect(busyModel.focus[`market:${MARKET}`]?.verbs.find((v) => v.name === 'Create vault')?.state).toBe('busy')

    const failed = new Map<string, PendingCall>([
      ['bookmaker.root.action.createVault', { phase: 'failed', error: 'AA23 reverted', startedAt: 1 }],
    ])
    const failedModel = mapBookmaker({ functions: wireFunctions(true), board: boardWith(1), pending: failed })
    expect(consoleModelViolations(failedModel)).toEqual([])
    const verb = failedModel.focus[`market:${MARKET}`]?.verbs.find((v) => v.name === 'Create vault')
    expect(verb).toMatchObject({ state: 'failed', reason: 'AA23 reverted' })
    expect(failedModel.attention.find((a) => a.tone === 'err')).toMatchObject({
      targetId: `market:${MARKET}`,
    })
  })

  it('settling createVault flashes the newest vault as fresh (the write landing)', () => {
    const settling = new Map<string, PendingCall>([
      ['bookmaker.root.action.createVault', { phase: 'settling', startedAt: 1 }],
    ])
    const model = mapBookmaker({ functions: wireFunctions(true), board: boardWith(2), pending: settling })
    const vaults = model.things.filter((t) => t.kind === 'vault')
    expect(vaults[0]?.fresh).toBeUndefined()
    expect(vaults[1]?.fresh).toBe(true)
  })
})
