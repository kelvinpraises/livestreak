// Live mapper: observe wire data → ConsoleModel, FAMILY world. Board = {revision, cells} where
// the session cell carries the observation index ({obsId: {title, chain}}) and each observation
// owns a cell family obs:<id>:{capture,publish,run,pause,market}
// (packages/observe/src/run/control/system/config.ts is the source of truth).
//
// The desk: Session → one titled row per observation → State. Every verb an observation owns
// lives on its card, sequenced by its run cell: Configure capture → Configure publish →
// Prepare (registers the market on-chain first) → Start → Go live → Pause → Set ended →
// Close out (remove). Titles come from the board; nobody reads an 0x label again.

import type { FunctionDescriptor } from '@livestreak/schema'
import type { AttentionCard, ConsoleFocusCard, ConsoleThing, ConsoleVerb, VerbField } from '#/types/console'
import type { PackageMapper, PendingCall } from '#/utils/console-map/types'
import { schemaToFields } from '#/utils/console-map/fields'

interface CellView {
  readonly status?: readonly [string, ...unknown[]]
  readonly settings?: Readonly<Record<string, unknown>>
  readonly readonly?: Readonly<Record<string, unknown>>
}

interface ObserveBoardView {
  readonly revision?: number
  readonly cells?: Readonly<Record<string, CellView>>
}

interface ObservationEntry {
  readonly title?: string
  readonly chain?: string
  readonly createdAtMs?: number
}

const asBoard = (board: unknown): ObserveBoardView =>
  board !== null && typeof board === 'object' ? (board as ObserveBoardView) : {}

const short = (hex: string): string => (hex.length > 10 ? `${hex.slice(0, 6)}…` : hex)

const cellState = (cell: CellView | undefined): string => cell?.status?.[0] ?? 'absent'

export const mapObserve: PackageMapper = ({ functions, board, pending }) => {
  const b = asBoard(board)
  const cells = b.cells ?? {}
  const session = cells['system:config']
  const rawIndex = session?.readonly?.observations
  const index: Readonly<Record<string, ObservationEntry>> =
    rawIndex !== null && typeof rawIndex === 'object'
      ? (rawIndex as Record<string, ObservationEntry>)
      : {}
  const obsIds = Object.keys(index).sort(
    (a, z) => (index[a]?.createdAtMs ?? 0) - (index[z]?.createdAtMs ?? 0)
  )

  const fnById = new Map(functions.map((fn) => [fn.id, fn]))
  const familyFn = (obsId: string, kind: string, name: string): FunctionDescriptor | undefined =>
    fnById.get(`observe.obs.${obsId}.${kind}.${name}`)
  const sessionFn = (name: string): FunctionDescriptor | undefined =>
    fnById.get(`observe.system.config.${name}`)
  const pendingFor = (fn: FunctionDescriptor | undefined): PendingCall | undefined =>
    fn === undefined ? undefined : pending.get(fn.id)
  const withPending = (verb: ConsoleVerb, entry: PendingCall | undefined): ConsoleVerb => {
    if (entry === undefined) return verb
    if (entry.phase === 'failed') return { ...verb, state: 'failed', reason: entry.error }
    return { ...verb, state: 'busy' }
  }
  const verbFor = (fn: FunctionDescriptor | undefined, verb: ConsoleVerb): ConsoleVerb =>
    withPending(fn === undefined ? verb : { ...verb, callRef: fn.id }, pendingFor(fn))

  const things: ConsoleThing[] = []
  const focus: Record<string, ConsoleFocusCard> = {}
  const attention: AttentionCard[] = []

  // --- session ---
  // An observation is created ON a chain. The session cell publishes the chains it can settle
  // on (readonly.chains — today the gateway wallet's one chain); the field renders as a select
  // over exactly those, never a typed CAIP-2 string.
  const rawChains = session?.readonly?.chains
  const chains = Array.isArray(rawChains) ? rawChains.filter((c): c is string => typeof c === 'string') : []
  const addFn = sessionFn('configure')
  things.push({
    id: 'session',
    kind: 'session',
    label: 'Session',
    note: obsIds.length === 0 ? 'no observation yet' : `${obsIds.length} observation${obsIds.length === 1 ? '' : 's'}`,
    tone: 'ok',
  })
  focus.session = {
    title: 'Session',
    sub: `open · ${obsIds.length} observation${obsIds.length === 1 ? '' : 's'}`,
    verbs:
      addFn === undefined
        ? []
        : [
            verbFor(addFn, {
              name: 'Add observation',
              state: 'ready',
              ...(obsIds.length === 0 ? { hot: true } : {}),
              fields: schemaToFields(addFn.inputSchema, {
                ...(chains[0] !== undefined ? { chain: chains[0] } : {}),
              }).map((f) =>
                f.name === 'chain' && chains.length > 0
                  ? { ...f, kind: 'select' as const, options: chains.map((c) => ({ label: c })) }
                  : f
              ),
            }),
          ],
  }
  if (obsIds.length === 0) {
    attention.push({
      title: 'Add an observation',
      detail: 'name it and pick its chain to begin',
      targetId: 'session',
      tone: 'do',
    })
  }

  // --- one card per observation family ---
  let firstObsThingId: string | undefined
  for (const obsId of obsIds) {
    const entry = index[obsId] ?? {}
    const title = entry.title ?? 'Observation'
    const thingId = `obs:${obsId}`
    if (firstObsThingId === undefined) firstObsThingId = thingId

    const capture = cells[`obs:${obsId}:capture`]
    const publish = cells[`obs:${obsId}:publish`]
    const run = cells[`obs:${obsId}:run`]
    const market = cells[`obs:${obsId}:market`]

    const runState = cellState(run)
    const running = runState === 'running'
    const paused = runState === 'paused'
    const prepared = runState === 'prepared'
    const beforePrepare = runState === 'created' || runState === 'absent'
    const failed = runState === 'failed'
    const registration = String(market?.readonly?.registrationState ?? 'none')
    const marketId = typeof market?.readonly?.marketId === 'string' ? market.readonly.marketId : undefined
    const registered = registration === 'registered' || registration === 'live' || registration === 'ended'
    const publishKind = typeof publish?.readonly?.kind === 'string' ? publish.readonly.kind : 'live'

    things.push({
      id: thingId,
      parentId: 'session',
      kind: 'observation',
      label: title,
      note: failed ? 'failed' : registration === 'live' ? 'live' : runState,
      tone: failed ? 'err' : running || registration === 'live' ? 'ok' : 'warn',
    })

    const verbs: ConsoleVerb[] = []

    // Config verbs sit on top, above the lifecycle (the operator's order of work).
    // Both configs render as DISCRIMINANTS (the remote-test segment UI): the kind choice up
    // top, its detail fields hanging off the rail beneath. The group value never reaches the
    // wire — coercion is schema-keyed.
    const captureFn = familyFn(obsId, 'capture', 'configure')
    if (captureFn !== undefined) {
      const captureFields = schemaToFields(captureFn.inputSchema, {
        ...(typeof capture?.settings?.path === 'string' ? { path: capture.settings.path } : {}),
      })
      verbs.push(
        verbFor(captureFn, {
          name: 'Configure capture',
          state: 'ready',
          // One source kind in v0 (file); the discriminant shape stands so a browser driver
          // lands as one more segment, no UI change.
          fields: [
            {
              name: 'source',
              value: 'file',
              kind: 'select',
              options: [{ label: 'file' }],
              arms: { file: captureFields },
            },
          ],
        })
      )
    }
    const publishFn = familyFn(obsId, 'publish', 'configure')
    const publishKindFn = sessionFn('publishKind')
    if (publishFn !== undefined) {
      // The wire ships only the MOUNTED sink's schema, so the active arm carries its real
      // fields and the others sit empty until a segment flip lands publishKind (details
      // reset on a kind switch by design — the new arm's fields arrive on the next push).
      const detailFields = schemaToFields(publishFn.inputSchema)
      const kindField: VerbField = {
        name: 'kind',
        value: publishKind,
        kind: 'select',
        options: [{ label: 'live' }, { label: 'direct' }, { label: 'file-export' }],
        arms: { live: [], direct: [], 'file-export': [], [publishKind]: detailFields },
      }
      verbs.push(
        verbFor(publishFn, {
          name: 'Configure publish',
          state: 'ready',
          fields: [kindField],
          // A changed kind re-shapes the cell first; details configure on the next Run.
          ...(publishKindFn !== undefined
            ? {
                switchRef: {
                  callRef: publishKindFn.id,
                  field: 'kind',
                  current: publishKind,
                  presetArgs: { obsId },
                },
              }
            : {}),
        })
      )
    }

    // Lifecycle, sequenced by the run cell.
    const prepareFn = familyFn(obsId, 'run', 'prepare')
    const startFn = familyFn(obsId, 'run', 'start')
    verbs.push(
      verbFor(
        prepareFn,
        beforePrepare
          ? { name: 'Prepare', state: 'ready', hot: true, hint: 'registers the market on-chain first' }
          : runState === 'preparing'
            ? { name: 'Prepare', state: 'busy' }
            : failed
              ? { name: 'Prepare', state: 'ready', hint: 'registers the market on-chain first' }
              : { name: 'Prepare', state: 'done' }
      )
    )
    verbs.push(
      verbFor(
        startFn,
        prepared
          ? { name: 'Start', state: 'ready', hot: true }
          : runState === 'starting'
            ? { name: 'Start', state: 'busy' }
            : beforePrepare || runState === 'preparing' || failed
              ? { name: 'Start', state: 'locked', hint: 'needs · prepared', path: 'prepare' }
              : { name: 'Start', state: 'done' }
      )
    )

    // Go live sits ABOVE Pause: it is the point of the whole ladder.
    const goLiveFn = familyFn(obsId, 'market', 'goLive')
    verbs.push(
      verbFor(
        goLiveFn,
        registration === 'live' || registration === 'ended'
          ? { name: 'Go live', state: 'done' }
          : registered && running
            ? {
                name: 'Go live',
                state: 'ready',
                hot: true,
                fields: schemaToFields(goLiveFn?.inputSchema),
              }
            : {
                name: 'Go live',
                state: 'locked',
                hint: 'needs · running stream',
                path: beforePrepare ? 'prepare → start' : prepared ? 'start' : 'prepare → start',
              }
      )
    )
    if (running || paused) {
      const pauseFn = familyFn(obsId, 'pause', paused ? 'resume' : 'pause')
      verbs.push(verbFor(pauseFn, { name: paused ? 'Resume' : 'Pause', state: 'ready' }))
    } else {
      verbs.push({ name: 'Pause', state: 'locked', hint: 'needs · running', path: 'prepare → start' })
    }
    const setEndedFn = familyFn(obsId, 'market', 'setEnded')
    verbs.push(
      verbFor(
        setEndedFn,
        registration === 'ended'
          ? { name: 'Set ended', state: 'done' }
          : registration === 'live'
            ? {
                // Guarded, not ready: field-less and irreversible. The first call freezes endedAt
                // on-chain and starts the 24h lock, after which the pointer can never be revised.
                name: 'Set ended',
                state: 'guarded',
                consequence:
                  'ends the stream on-chain. The end time is frozen immediately and the recording pointer can only be revised for 24 hours after that',
              }
            : { name: 'Set ended', state: 'locked', hint: 'needs · live' }
      )
    )

    const removeFn = sessionFn('remove')
    if (removeFn !== undefined) {
      verbs.push(
        verbFor(removeFn, {
          name: 'Close out',
          state: 'guarded',
          presetArgs: { obsId },
          consequence:
            'removes this observation from your session and stops capture and publish. Registered markets stay on-chain',
        })
      )
    }

    focus[thingId] = {
      title,
      sub: [
        failed ? 'failed' : registration === 'live' ? 'live' : runState,
        entry.chain ?? 'chain unknown',
        registered && marketId !== undefined ? `${short(marketId)} registered` : 'no market yet',
      ].join(' · '),
      verbs,
      ...(marketId !== undefined ? { history: [`marketId · ${marketId}`] } : {}),
    }

    // The frontier per observation: one next step.
    if (failed) {
      attention.push({ title: `${title} failed`, detail: 'see the run state and retry', targetId: thingId, tone: 'err' })
    } else if (beforePrepare) {
      attention.push({
        title: `Prepare ${title}`,
        detail: 'registers the market on-chain, then: start → go live',
        targetId: thingId,
        tone: 'do',
      })
    } else if (prepared) {
      attention.push({ title: `Start ${title}`, detail: 'then: go live', targetId: thingId, tone: 'do' })
    } else if (running && registered && registration !== 'live') {
      attention.push({ title: `Go live: ${title}`, detail: 'stream and market are ready', targetId: thingId, tone: 'do' })
    } else if (runState === 'stopped' && registration !== 'ended') {
      attention.push({ title: `${title} stopped`, detail: runState, targetId: thingId, tone: 'wait' })
    }
  }

  // --- state root ---
  // No revision in the model: it climbs every tick and would force a full re-render per push.
  // The raw board (gear drawer) is the place to watch revisions.
  things.push({
    id: 'state',
    kind: 'state',
    label: 'State',
    note: 'connected',
    tone: 'idle',
  })
  focus.state = {
    title: 'State',
    sub: `connected · ${obsIds.length} observation${obsIds.length === 1 ? '' : 's'}`,
    verbs: [],
    history: [`observations · ${obsIds.length}`],
  }

  for (const [ref, entry] of pending) {
    if (entry.phase !== 'failed') continue
    const fn = functions.find((f) => f.id === ref)
    if (fn === undefined) continue
    const match = /^observe\.obs\.([^.]+)\./.exec(ref)
    attention.push({
      title: `${fn.label} failed`,
      detail: entry.error ?? 'failed',
      targetId: match !== null && focus[`obs:${match[1]}`] !== undefined ? `obs:${match[1]}` : 'session',
      tone: 'err',
    })
  }

  return {
    role: 'observe',
    things,
    focus,
    attention,
    defaultFocusId: firstObsThingId ?? 'session',
  }
}
