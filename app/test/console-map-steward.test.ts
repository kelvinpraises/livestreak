// Golden test for the steward mapper: subjects → desk things (vault under its watched market),
// findings → attention + hot Resolve, subjectId/subjectKind preset so no id is ever typed.
// Shapes mirror packages/steward/src/bridge/panel/descriptors.ts (subjectGroupIdFor slugs).

import { describe, expect, it } from 'vitest'
import type { FunctionDescriptor } from '@livestreak/schema'
import { mapSteward } from '../src/utils/console-map/map-steward'
import type { PendingCall } from '../src/utils/console-map/types'
import { consoleModelViolations } from './helpers/console-invariants'

const MARKET = '0x2669e60cf22c8f8bd2d1a9f7203e59a921bd66c96626e0864a5d1e4478d34ed8'
const VAULT = '0x39e9aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22aa33bb44cc55'
const slug = (v: string): string => v.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 64)

const subjectAction = (subjectId: string, name: string, over: Partial<FunctionDescriptor> = {}): FunctionDescriptor => ({
  id: `steward.subject.${slug(subjectId)}.action.${name}`,
  parentId: `steward.subject.${slug(subjectId)}`,
  package: 'steward',
  name,
  label: name,
  scope: `bridge:action:${name}`,
  disabled: false,
  ...over,
})

const wireFunctions: FunctionDescriptor[] = [
  { id: 'steward.config.configure', package: 'steward', name: 'configure', label: 'Configure steward', scope: 'bridge:action:configure', disabled: false },
  subjectAction(MARKET, 'openThread', { label: 'Open thread' }),
  subjectAction(VAULT, 'resolve', { label: 'Resolve', target: { kind: 'vault', vaultId: VAULT } }),
  subjectAction(VAULT, 'annotate', { label: 'Annotate' }),
  subjectAction(VAULT, 'triggerHot', { label: 'Trigger hot' }),
]

const boardFixture = {
  revision: 9,
  panel: {
    runtimeId: 'steward-1',
    watchedSubjects: [
      { kind: 'steward', id: 'steward-1' },
      { kind: 'market', id: MARKET, marketId: MARKET },
      { kind: 'vault', id: VAULT, marketId: MARKET, vaultId: VAULT },
    ],
    latestFindings: [
      {
        id: 'finding-1',
        kind: 'market_hot',
        subject: { kind: 'vault', id: VAULT, marketId: MARKET, vaultId: VAULT },
        severity: 'warning',
        message: 'pool moving fast',
        evidenceRefs: ['walrus:0x8c11'],
      },
    ],
    summary: { watchedSubjectCount: 3, findingCount: 1, pendingPlanCount: 0 },
  },
}

const NONE: ReadonlyMap<string, PendingCall> = new Map()

describe('mapSteward', () => {
  const model = mapSteward({ functions: wireFunctions, board: boardFixture, pending: NONE })

  it('honors the ConsoleModel contract', () => {
    expect(consoleModelViolations(model)).toEqual([])
  })

  it('vault subject nests under its watched market; steward-self subject never appears', () => {
    const vault = model.things.find((t) => t.kind === 'vault')
    expect(vault).toMatchObject({ id: `vault:${VAULT}`, parentId: `market:${MARKET}`, tone: 'warn', note: 'finding' })
    expect(model.things.some((t) => t.id === 'subject:steward-1')).toBe(false)
  })

  it('the finding drives attention, default focus, the hot Resolve, and the evidence line', () => {
    expect(model.defaultFocusId).toBe(`vault:${VAULT}`)
    expect(model.attention[0]).toMatchObject({ title: 'Review market_hot finding', targetId: `vault:${VAULT}`, tone: 'do' })
    const card = model.focus[`vault:${VAULT}`]
    expect(card?.sub).toBe('finding market_hot · warning')
    expect(card?.history).toEqual(['evidence · walrus:0x8c11'])
    const resolve = card?.verbs.find((v) => v.name === 'Resolve')
    expect(resolve).toMatchObject({ state: 'ready', hot: true, callRef: `steward.subject.${slug(VAULT)}.action.resolve` })
    expect(resolve?.presetArgs).toEqual({ subjectId: VAULT, subjectKind: 'vault', findingId: 'finding-1' })
    expect(resolve?.fields?.map((f) => f.name)).toEqual(['outcome', 'reason'])
  })

  it('annotate maps its note field onto the wire reason arg', () => {
    const annotate = model.focus[`vault:${VAULT}`]?.verbs.find((v) => v.name === 'Annotate')
    expect(annotate?.fields?.[0]).toMatchObject({ name: 'note', arg: 'reason' })
  })

  it('nothing watched: session-only desk with a do-card', () => {
    const empty = mapSteward({
      functions: [wireFunctions[0] as FunctionDescriptor],
      board: { revision: 0, panel: { runtimeId: 's', watchedSubjects: [], latestFindings: [] } },
      pending: NONE,
    })
    expect(consoleModelViolations(empty)).toEqual([])
    expect(empty.things.map((t) => t.kind)).toEqual(['session', 'state'])
    expect(empty.attention[0]).toMatchObject({ targetId: 'session', tone: 'do' })
  })
})
