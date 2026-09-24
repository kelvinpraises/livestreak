// Live mapper: steward wire data → ConsoleModel. Board = StewardBoard {revision, panel}
// (duck-typed; packages/steward/src/model/panel.ts is the source of truth). Subjects become
// desk things (vaults under their market when both are watched), findings become attention
// cards, and each subject card carries the fixture-approved verb set — resolve/annotate/
// trigger-hot on vaults, open-thread on markets — with subjectId/subjectKind preset from the
// subject so the operator never types an id.

import type { FunctionDescriptor } from '@livestreak/schema'
import type { AttentionCard, ConsoleFocusCard, ConsoleThing, ConsoleVerb } from '#/types/console'
import type { PackageMapper, PendingCall } from '#/utils/console-map/types'

interface SubjectView {
  readonly kind: string
  readonly id: string
  readonly marketId?: string
  readonly vaultId?: string
}

interface FindingView {
  readonly id: string
  readonly kind: string
  readonly subject: SubjectView
  readonly severity: string
  readonly message: string
  readonly evidenceRefs?: readonly string[]
  readonly createdAtMs?: number
}

interface StewardBoardView {
  readonly revision?: number
  readonly panel?: {
    readonly runtimeId?: string
    readonly watchedSubjects?: readonly SubjectView[]
    readonly latestFindings?: readonly FindingView[]
    readonly lastError?: string
    readonly summary?: {
      readonly watchedSubjectCount?: number
      readonly findingCount?: number
      readonly pendingPlanCount?: number
    }
  }
}

const asBoard = (board: unknown): StewardBoardView =>
  board !== null && typeof board === 'object' ? (board as StewardBoardView) : {}

const short = (hex: string): string => (hex.length > 10 ? `${hex.slice(0, 6)}…` : hex)

/** Mirrors the package's subjectGroupIdFor slug so descriptor ids can be matched per subject. */
const idSlug = (value: string): string => value.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 64)

const thingIdFor = (subject: SubjectView): string =>
  subject.kind === 'vault'
    ? `vault:${subject.vaultId ?? subject.id}`
    : subject.kind === 'market'
      ? `market:${subject.marketId ?? subject.id}`
      : `subject:${subject.id}`

export const mapSteward: PackageMapper = ({ functions, board, pending }) => {
  const b = asBoard(board)
  const panel = b.panel ?? {}
  const subjects = (panel.watchedSubjects ?? []).filter(
    (s) => s.kind === 'vault' || s.kind === 'market'
  )
  const findings = panel.latestFindings ?? []

  const fnFor = (subject: SubjectView, name: string): FunctionDescriptor | undefined =>
    functions.find((f) => f.id === `steward.subject.${idSlug(subject.id)}.action.${name}`)
  const pendingFor = (fn: FunctionDescriptor | undefined): PendingCall | undefined =>
    fn === undefined ? undefined : pending.get(fn.id)
  const withPending = (verb: ConsoleVerb, entry: PendingCall | undefined): ConsoleVerb => {
    if (entry === undefined) return verb
    if (entry.phase === 'failed') return { ...verb, state: 'failed', reason: entry.error }
    return { ...verb, state: 'busy' }
  }
  const verbFor = (
    subject: SubjectView,
    name: string,
    verb: Omit<ConsoleVerb, 'callRef' | 'presetArgs'> & { readonly presetArgs?: Readonly<Record<string, string>> }
  ): ConsoleVerb | undefined => {
    const fn = fnFor(subject, name)
    if (fn === undefined) return undefined
    const built: ConsoleVerb = {
      ...verb,
      callRef: fn.id,
      // The operator never types subject ids — the subject IS the card.
      presetArgs: { subjectId: subject.id, subjectKind: subject.kind, ...verb.presetArgs },
      ...(fn.disabled && verb.state === 'ready'
        ? { state: 'locked' as const, hint: fn.disabledReason ?? 'unavailable' }
        : {}),
    }
    return withPending(built, pendingFor(fn))
  }

  const things: ConsoleThing[] = []
  const focus: Record<string, ConsoleFocusCard> = {}
  const attention: AttentionCard[] = []

  // --- session ---
  const configureFn = functions.find((f) => f.name === 'configure')
  things.push({
    id: 'session',
    kind: 'session',
    label: 'Session',
    note: subjects.length > 0 ? `watching ${subjects.length}` : 'watching nothing',
    tone: 'ok',
  })
  const watchVerb: ConsoleVerb | undefined =
    configureFn === undefined
      ? undefined
      : withPending(
          {
            name: 'Watch',
            state: 'ready',
            callRef: configureFn.id,
            ...(subjects.length === 0 ? { hot: true } : {}),
            // Host market list isn't on the wire yet — raw ids until that feed lands.
            fields: [
              { name: 'marketId', value: '' },
              { name: 'vaultId', value: '' },
            ],
          },
          pendingFor(configureFn)
        )
  focus.session = {
    title: 'Session',
    sub: `watching · ${subjects.length} subject${subjects.length === 1 ? '' : 's'}`,
    verbs: watchVerb === undefined ? [] : [watchVerb],
  }
  if (subjects.length === 0) {
    attention.push({
      title: 'Watch a market or vault',
      detail: 'nothing under review yet',
      targetId: 'session',
      tone: 'do',
    })
  }

  // --- subjects: markets first so vaults can nest under them ---
  const marketThingIds = new Map<string, string>()
  for (const subject of subjects.filter((s) => s.kind === 'market')) {
    const thingId = thingIdFor(subject)
    marketThingIds.set(subject.marketId ?? subject.id, thingId)
    const subjectFindings = findings.filter((f) => f.subject.id === subject.id && f.subject.kind === 'market')
    things.push({
      id: thingId,
      parentId: 'session',
      kind: 'market',
      label: short(subject.marketId ?? subject.id),
      note: subjectFindings.length === 0 ? 'quiet' : `${subjectFindings.length} finding${subjectFindings.length === 1 ? '' : 's'}`,
      tone: subjectFindings.length === 0 ? 'ok' : 'warn',
    })
    const openThread = verbFor(subject, 'openThread', {
      name: 'Open thread',
      state: 'ready',
      fields: [{ name: 'reason', value: '' }],
    })
    focus[thingId] = {
      title: short(subject.marketId ?? subject.id),
      sub: `${subjectFindings.length === 0 ? 'quiet' : 'findings'} · ${subjectFindings.length} finding${subjectFindings.length === 1 ? '' : 's'}`,
      verbs: openThread === undefined ? [] : [openThread],
    }
  }

  for (const subject of subjects.filter((s) => s.kind === 'vault')) {
    const thingId = thingIdFor(subject)
    const parentId = subject.marketId !== undefined ? marketThingIds.get(subject.marketId) : undefined
    const subjectFindings = findings.filter((f) => f.subject.id === subject.id && f.subject.kind === 'vault')
    const latest = subjectFindings[subjectFindings.length - 1]
    things.push({
      id: thingId,
      parentId: parentId ?? 'session',
      kind: 'vault',
      label: `Vault ${short(subject.vaultId ?? subject.id)}`,
      note: latest !== undefined ? 'finding' : 'quiet',
      tone: latest !== undefined ? 'warn' : 'ok',
    })

    const verbs: ConsoleVerb[] = []
    const resolve = verbFor(subject, 'resolve', {
      name: 'Resolve',
      state: 'ready',
      ...(latest !== undefined ? { hot: true } : {}),
      fields: [
        { name: 'outcome', value: 'yes', kind: 'select', options: [{ label: 'yes' }, { label: 'no' }] },
        { name: 'reason', value: '' },
      ],
      ...(latest !== undefined ? { presetArgs: { findingId: latest.id } } : {}),
    })
    if (resolve !== undefined) verbs.push(resolve)
    const annotate = verbFor(subject, 'annotate', {
      name: 'Annotate',
      state: 'ready',
      fields: [{ name: 'note', arg: 'reason', value: '' }],
      ...(latest !== undefined ? { presetArgs: { findingId: latest.id } } : {}),
    })
    if (annotate !== undefined) verbs.push(annotate)
    const triggerHot = verbFor(subject, 'triggerHot', {
      name: 'Trigger hot',
      state: 'ready',
      fields: [{ name: 'reason', value: '' }],
      ...(latest !== undefined ? { presetArgs: { findingId: latest.id } } : {}),
    })
    if (triggerHot !== undefined) verbs.push(triggerHot)

    focus[thingId] = {
      title: `Vault ${short(subject.vaultId ?? subject.id)}`,
      sub:
        latest !== undefined
          ? `finding ${latest.kind} · ${latest.severity}`
          : 'quiet · nothing to review',
      verbs,
      ...(latest?.evidenceRefs !== undefined && latest.evidenceRefs.length > 0
        ? { history: [`evidence · ${latest.evidenceRefs[0]}`] }
        : {}),
    }
    for (const finding of subjectFindings) {
      attention.push({
        title: `Review ${finding.kind} finding`,
        detail: finding.message,
        targetId: thingId,
        tone: 'do',
      })
    }
  }

  // --- state root ---
  const pendingPlans = panel.summary?.pendingPlanCount ?? 0
  things.push({
    id: 'state',
    kind: 'state',
    label: 'State',
    note: `${findings.length} finding${findings.length === 1 ? '' : 's'}`,
    tone: panel.lastError !== undefined ? 'err' : 'idle',
  })
  focus.state = {
    title: 'State',
    sub: `${panel.lastError !== undefined ? 'error' : 'watching'} · ${findings.length} finding${findings.length === 1 ? '' : 's'} · ${pendingPlans} pending plan${pendingPlans === 1 ? '' : 's'}`,
    verbs: [],
    history: [
      `runtime · ${panel.runtimeId ?? 'unknown'}`,
      ...(panel.lastError !== undefined ? [`error · ${panel.lastError}`] : []),
    ],
  }
  if (panel.lastError !== undefined) {
    attention.push({ title: 'Steward error', detail: panel.lastError, targetId: 'state', tone: 'err' })
  }

  // Failed calls point at the subject card that fired them.
  for (const [ref, entry] of pending) {
    if (entry.phase !== 'failed') continue
    const fn = functions.find((f) => f.id === ref)
    if (fn === undefined) continue
    const subject = subjects.find((s) => ref.startsWith(`steward.subject.${idSlug(s.id)}.`))
    attention.push({
      title: `${fn.label} failed`,
      detail: entry.error ?? 'failed',
      targetId: subject !== undefined ? thingIdFor(subject) : 'session',
      tone: 'err',
    })
  }

  const firstFindingSubject = findings
    .map((f) => subjects.find((s) => s.id === f.subject.id && s.kind === f.subject.kind))
    .find((s) => s !== undefined)
  const firstVault = subjects.find((s) => s.kind === 'vault')
  return {
    role: 'steward',
    things,
    focus,
    attention,
    defaultFocusId:
      firstFindingSubject !== undefined
        ? thingIdFor(firstFindingSubject)
        : firstVault !== undefined
          ? thingIdFor(firstVault)
          : 'session',
  }
}
