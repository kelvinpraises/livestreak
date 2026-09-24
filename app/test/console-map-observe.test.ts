// Golden test for the observe mapper, FAMILY world: session observation index + obs:<id>:* cell
// families + observe.obs.<id>.<cell>.<fn> descriptors → titled desk rows, per-observation cards,
// Go live above Pause, kind switch on Configure publish, guarded Close out with preset obsId.
// Shapes mirror packages/observe/src/run/control/system/config.ts.

import { describe, expect, it } from 'vitest'
import type { FunctionDescriptor, JsonSchema } from '@livestreak/schema'
import { mapObserve } from '../src/utils/console-map/map-observe'
import type { PendingCall } from '../src/utils/console-map/types'
import { consoleModelViolations } from './helpers/console-invariants'

const OBS = 'aaaa-bbbb'
const MARKET = '0x8f21e60cf22c8f8bd2d1a9f7203e59a921bd66c96626e0864a5d1e4478d34ed8'

const obj = (props: readonly { name: string; type?: string; values?: string[] }[]): JsonSchema => ({
  type: 'object',
  properties: props.map((p) => ({
    name: p.name,
    value: { type: (p.type ?? 'string') as 'string', required: true, ...(p.values ? { values: p.values } : {}) },
    help: '',
  })),
})

const fn = (id: string, name: string, over: Partial<FunctionDescriptor> = {}): FunctionDescriptor => ({
  id,
  package: 'observe',
  name,
  label: name,
  scope: `bridge:action:${name}`,
  disabled: false,
  ...over,
})

const wireFunctions: FunctionDescriptor[] = [
  fn('observe.system.config.configure', 'configure', {
    inputSchema: obj([{ name: 'title' }, { name: 'chain' }]),
  }),
  fn('observe.system.config.remove', 'remove', { inputSchema: obj([{ name: 'obsId' }]) }),
  fn('observe.system.config.publishKind', 'publishKind', {
    inputSchema: obj([{ name: 'obsId' }, { name: 'kind', type: 'enum', values: ['live', 'direct', 'file-export'] }]),
  }),
  fn(`observe.obs.${OBS}.capture.configure`, 'configure', { inputSchema: obj([{ name: 'path' }]) }),
  // The live sink's configure carries NO fields — streamId is board-derived from the market cell.
  fn(`observe.obs.${OBS}.publish.configure`, 'configure'),
  fn(`observe.obs.${OBS}.run.prepare`, 'prepare'),
  fn(`observe.obs.${OBS}.run.start`, 'start'),
  fn(`observe.obs.${OBS}.pause.pause`, 'pause'),
  // goLive/setEnded carry NO fields — pointer and scheme are board-derived in the package.
  fn(`observe.obs.${OBS}.market.goLive`, 'goLive'),
  fn(`observe.obs.${OBS}.market.setEnded`, 'setEnded'),
]

const cell = (state: string, extra: Partial<{ settings: Record<string, unknown>; readonly: Record<string, unknown> }> = {}) => ({
  status: [state, null, 1] as const,
  ...extra,
})

const boardAt = (runState: string, registration: string) => ({
  revision: 7,
  cells: {
    'system:config': cell('configured', {
      readonly: {
        runId: 'run-1',
        chains: ['eip155:31337'],
        observations: { [OBS]: { title: 'Friday Cup', chain: 'eip155:31337', createdAtMs: 1 } },
      },
    }),
    [`obs:${OBS}:capture`]: cell('idle', { readonly: { configured: false, kind: 'file' }, settings: {} }),
    [`obs:${OBS}:publish`]: cell('idle', { readonly: { configured: false, kind: 'live' } }),
    [`obs:${OBS}:run`]: cell(runState, { readonly: { runId: 'run-1', obsId: OBS } }),
    [`obs:${OBS}:pause`]: cell('idle'),
    [`obs:${OBS}:market`]: cell(registration, {
      readonly: {
        registrationState: registration,
        title: 'Friday Cup',
        chain: 'eip155:31337',
        ...(registration === 'none' ? {} : { marketId: MARKET }),
      },
    }),
  },
})

const NONE: ReadonlyMap<string, PendingCall> = new Map()

describe('mapObserve (families)', () => {
  it('empty session: Add observation carries title + a chain SELECT from the board chains', () => {
    const model = mapObserve({
      functions: [wireFunctions[0] as FunctionDescriptor],
      board: {
        revision: 1,
        cells: {
          'system:config': cell('idle', { readonly: { runId: 'run-1', chains: ['eip155:31337'] } }),
        },
      },
      pending: NONE,
    })
    expect(consoleModelViolations(model)).toEqual([])
    expect(model.things.map((t) => t.kind)).toEqual(['session', 'state'])
    const add = model.focus.session?.verbs.find((v) => v.name === 'Add observation')
    expect(add).toMatchObject({ state: 'ready', hot: true, callRef: 'observe.system.config.configure' })
    expect(add?.fields?.map((f) => f.name)).toEqual(['title', 'chain'])
    // The chain is a dropdown over the session's settleable chains — never a typed CAIP-2 string.
    const chain = add?.fields?.find((f) => f.name === 'chain')
    expect(chain).toMatchObject({ kind: 'select', value: 'eip155:31337' })
    expect(chain?.options?.map((o) => o.label)).toEqual(['eip155:31337'])
  })

  it('created: titled desk row, config on top, Go live above Pause, guarded Close out', () => {
    const model = mapObserve({ functions: wireFunctions, board: boardAt('created', 'none'), pending: NONE })
    expect(consoleModelViolations(model)).toEqual([])

    const obs = model.things.find((t) => t.kind === 'observation')
    expect(obs).toMatchObject({ id: `obs:${OBS}`, parentId: 'session', label: 'Friday Cup' })

    const card = model.focus[`obs:${OBS}`]
    expect(card?.title).toBe('Friday Cup')
    expect(card?.sub).toBe('created · eip155:31337 · no market yet')
    const names = card?.verbs.map((v) => v.name) ?? []
    expect(names).toEqual([
      'Configure capture',
      'Configure publish',
      'Prepare',
      'Start',
      'Go live',
      'Pause',
      'Set ended',
      'Close out',
    ])
    // Go live sits above Pause.
    expect(names.indexOf('Go live')).toBeLessThan(names.indexOf('Pause'))

    const byName = new Map(card?.verbs.map((v) => [v.name, v]))
    expect(byName.get('Prepare')).toMatchObject({ state: 'ready', hot: true, callRef: `observe.obs.${OBS}.run.prepare` })
    expect(byName.get('Start')).toMatchObject({ state: 'locked', path: 'prepare' })
    const closeOut = byName.get('Close out')
    expect(closeOut).toMatchObject({ state: 'guarded', callRef: 'observe.system.config.remove' })
    expect(closeOut?.presetArgs).toEqual({ obsId: OBS })

    // Configure capture is a DISCRIMINANT: source segments up top, the wire fields in the arm.
    const captureVerb = byName.get('Configure capture')
    expect(captureVerb?.fields?.[0]).toMatchObject({ name: 'source', value: 'file', kind: 'select' })
    expect(captureVerb?.fields?.[0]?.arms?.file?.map((f) => f.name)).toEqual(['path'])

    // The kind switch rides Configure publish — a discriminant whose ACTIVE arm carries the
    // mounted sink's wire fields; the other arms fill after a segment flip lands publishKind.
    const publish = byName.get('Configure publish')
    expect(publish?.fields).toHaveLength(1)
    expect(publish?.fields?.[0]).toMatchObject({ name: 'kind', value: 'live' })
    expect(Object.keys(publish?.fields?.[0]?.arms ?? {})).toEqual(['live', 'direct', 'file-export'])
    expect(publish?.switchRef).toMatchObject({
      callRef: 'observe.system.config.publishKind',
      field: 'kind',
      current: 'live',
    })
    expect(publish?.switchRef?.presetArgs).toEqual({ obsId: OBS })

    expect(model.attention[0]).toMatchObject({ title: 'Prepare Friday Cup', tone: 'do' })
  })

  it('running + registered: Go live hot and field-less; sub names the market', () => {
    const model = mapObserve({ functions: wireFunctions, board: boardAt('running', 'registered'), pending: NONE })
    expect(consoleModelViolations(model)).toEqual([])
    const card = model.focus[`obs:${OBS}`]
    const byName = new Map(card?.verbs.map((v) => [v.name, v]))
    expect(byName.get('Prepare')?.state).toBe('done')
    expect(byName.get('Start')?.state).toBe('done')
    const goLive = byName.get('Go live')
    expect(goLive).toMatchObject({ state: 'ready', hot: true, callRef: `observe.obs.${OBS}.market.goLive` })
    expect(goLive?.fields ?? []).toEqual([])
    expect(byName.get('Pause')).toMatchObject({ state: 'ready', callRef: `observe.obs.${OBS}.pause.pause` })
    expect(card?.sub).toContain(`${MARKET.slice(0, 6)}… registered`)
    expect(card?.history).toEqual([`marketId · ${MARKET}`])
  })

  it('live: Set ended guarded, no do-cards left, tone ok', () => {
    const model = mapObserve({ functions: wireFunctions, board: boardAt('running', 'live'), pending: NONE })
    expect(consoleModelViolations(model)).toEqual([])
    const byName = new Map(model.focus[`obs:${OBS}`]?.verbs.map((v) => [v.name, v]))
    expect(byName.get('Go live')?.state).toBe('done')
    // Field-less AND irreversible (freezes endedAt, starts the 24h lock) — hold-to-run, not one click.
    expect(byName.get('Set ended')?.state).toBe('guarded')
    expect(byName.get('Set ended')?.consequence).toContain('24 hours')
    expect(byName.get('Set ended')?.fields ?? []).toEqual([])
    expect(model.attention.filter((a) => a.tone === 'do')).toEqual([])
    expect(model.things.find((t) => t.kind === 'observation')?.note).toBe('live')
  })

  it('two observations: independent rows, cards and frontiers', () => {
    const OBS2 = 'cccc-dddd'
    const base = boardAt('running', 'live')
    const board = {
      ...base,
      cells: {
        ...base.cells,
        'system:config': cell('configured', {
          readonly: {
            runId: 'run-1',
            observations: {
              [OBS]: { title: 'Friday Cup', chain: 'eip155:31337', createdAtMs: 1 },
              [OBS2]: { title: 'Street Chess', chain: 'solana', createdAtMs: 2 },
            },
          },
        }),
        [`obs:${OBS2}:capture`]: cell('idle', { readonly: { configured: false, kind: 'file' } }),
        [`obs:${OBS2}:publish`]: cell('idle', { readonly: { configured: false, kind: 'live' } }),
        [`obs:${OBS2}:run`]: cell('created', { readonly: { runId: 'run-1', obsId: OBS2 } }),
        [`obs:${OBS2}:pause`]: cell('idle'),
        [`obs:${OBS2}:market`]: cell('none', {
          readonly: { registrationState: 'none', title: 'Street Chess', chain: 'solana' },
        }),
      },
    }
    const fns = [
      ...wireFunctions,
      fn(`observe.obs.${OBS2}.run.prepare`, 'prepare'),
      fn(`observe.obs.${OBS2}.capture.configure`, 'configure', { inputSchema: obj([{ name: 'path' }]) }),
    ]
    const model = mapObserve({ functions: fns, board, pending: NONE })
    expect(consoleModelViolations(model)).toEqual([])
    expect(model.things.filter((t) => t.kind === 'observation').map((t) => t.label)).toEqual([
      'Friday Cup',
      'Street Chess',
    ])
    expect(model.focus[`obs:${OBS2}`]?.sub).toBe('created · solana · no market yet')
    // Each observation carries its own frontier card; the live one is quiet.
    expect(model.attention.map((a) => a.title)).toEqual(['Prepare Street Chess'])
    expect(
      new Map(model.focus[`obs:${OBS2}`]?.verbs.map((v) => [v.name, v])).get('Prepare')
    ).toMatchObject({ state: 'ready', hot: true, callRef: `observe.obs.${OBS2}.run.prepare` })
  })
})
