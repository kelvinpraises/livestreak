// Live mapper: bookmaker wire data → ConsoleModel. The board is the bridge's BookmakerPanelView
// (duck-typed here — packages/bookmaker/src/model/watch-source.ts is the source of truth); the
// functions are configure/close/createVault from projectBookmakerDescriptors.
//
// Wire honesty notes, resolved in later phases:
// - The board carries no market TITLE, only the marketId hex — the desk shows the short id until
//   the host catalog feeds the picker/labels (walk-backwards: board or app grows the join).
// - createVault's result vaultId reaches the wire smuggled through RemoteCallOutcome.tokenId
//   (cli/src/adapters/bookmaker-edge.ts:61) — unused here; freshness derives from the board.
// - Vault rows carry no verbs: the bookmaker bridge exposes no per-vault action yet (stopSeed is
//   on-chain but not bridged), so the fixture's "Stop seed" stays out until the ActionDef phase.

import type { FunctionDescriptor } from '@livestreak/schema'
import type { AttentionCard, ConsoleFocusCard, ConsoleThing, ConsoleVerb, VerbState } from '#/types/console'
import type { PackageMapper, PendingCall } from '#/utils/console-map/types'

interface BookmakerBoardView {
  readonly runtimeId?: string
  readonly marketId?: string
  readonly writeIntents?: readonly unknown[]
  readonly completedVaultCreations?: readonly {
    readonly intent?: { readonly question?: string; readonly creatorSide?: string }
    readonly result?: { readonly txId?: string; readonly vaultId?: string }
  }[]
  readonly lastError?: string
  readonly updatedAtMs?: number
}

const asBoard = (board: unknown): BookmakerBoardView =>
  board !== null && typeof board === 'object' ? (board as BookmakerBoardView) : {}

const short = (hex: string): string => (hex.length > 10 ? `${hex.slice(0, 6)}…` : hex)

/** Overlay an in-flight/failed call onto a verb: busy and settling render as busy (the write is
 *  not done until the board says so), failed carries its reason and a Retry. */
const withPending = (verb: ConsoleVerb, entry: PendingCall | undefined): ConsoleVerb => {
  if (entry === undefined) return verb
  if (entry.phase === 'failed') return { ...verb, state: 'failed', reason: entry.error }
  return { ...verb, state: 'busy' }
}

export const mapBookmaker: PackageMapper = ({ functions, board, pending }) => {
  const b = asBoard(board)
  const fnByName = new Map(functions.map((fn) => [fn.name, fn]))
  const configureFn = fnByName.get('configure')
  const closeFn = fnByName.get('close')
  const createVaultFn = fnByName.get('createVault')
  const pendingFor = (fn: FunctionDescriptor | undefined): PendingCall | undefined =>
    fn === undefined ? undefined : pending.get(fn.id)

  const marketId = (b.marketId ?? '').trim()
  const hasMarket = marketId.length > 0
  const marketThingId = hasMarket ? `market:${marketId}` : undefined
  const vaults = b.completedVaultCreations ?? []
  const pendingWrites = b.writeIntents?.length ?? 0

  // --- things (STABILITY: ids from entity ids, never indices) ---
  const things: ConsoleThing[] = [
    {
      id: 'session',
      kind: 'session',
      label: 'Session',
      note: hasMarket ? '1 market' : 'no market yet',
      tone: 'ok',
    },
  ]
  const createPending = pendingFor(createVaultFn)
  if (marketThingId !== undefined) {
    things.push({
      id: marketThingId,
      kind: 'market',
      label: short(marketId),
      note: `${vaults.length} vault${vaults.length === 1 ? '' : 's'}`,
      tone: vaults.length === 0 ? 'warn' : 'ok',
    })
    vaults.forEach((v, i) => {
      const vaultId = v.result?.vaultId ?? ''
      if (vaultId === '') return
      things.push({
        id: `vault:${vaultId}`,
        parentId: marketThingId,
        kind: 'vault',
        label: v.intent?.question ?? short(vaultId),
        note: 'open',
        tone: 'ok',
        // The newest vault flashes while its create call is still settling — the write landing.
        ...(i === vaults.length - 1 && createPending?.phase === 'settling' ? { fresh: true } : {}),
      })
    })
  }
  things.push({
    id: 'state',
    kind: 'state',
    label: 'State',
    note: `${pendingWrites} pending`,
    tone: b.lastError !== undefined ? 'err' : 'idle',
  })

  // --- focus cards ---
  const focus: Record<string, ConsoleFocusCard> = {}

  const addMarketVerb: ConsoleVerb | undefined =
    configureFn === undefined
      ? undefined
      : withPending(
          {
            name: 'Add market',
            state: 'ready' satisfies VerbState,
            callRef: configureFn.id,
            ...(hasMarket ? {} : { hot: true }),
            fields: [{ name: 'marketId', value: marketId }],
          },
          pendingFor(configureFn)
        )

  focus.session = {
    title: 'Session',
    sub: `${hasMarket ? 'configured' : 'open'} · ${b.runtimeId !== undefined ? short(b.runtimeId) : 'bookmaker'}`,
    verbs: addMarketVerb === undefined ? [] : [addMarketVerb],
  }

  if (marketThingId !== undefined) {
    const verbs: ConsoleVerb[] = []
    if (createVaultFn !== undefined) {
      verbs.push(
        withPending(
          {
            name: 'Create vault',
            state: createVaultFn.disabled ? 'locked' : 'ready',
            callRef: createVaultFn.id,
            ...(createVaultFn.disabled
              ? { hint: createVaultFn.disabledReason ?? 'unavailable' }
              : { hot: true }),
            fields: [
              { name: 'question', value: '' },
              {
                name: 'seed side',
                arg: 'creatorSide',
                value: 'yes',
                kind: 'select',
                options: [{ label: 'yes' }, { label: 'no' }],
              },
              // Base-unit integers, matching the wire schema (format: bigint). Human units
              // arrive with the ActionDef phase, where the def can carry decimals.
              { name: 'stake · base units', arg: 'creatorStake', value: '5000000', kind: 'number' },
              { name: 'rate · base units/s', arg: 'seedRate', value: '10000', kind: 'number' },
            ],
          },
          pendingFor(createVaultFn)
        )
      )
    }
    if (closeFn !== undefined) {
      verbs.push(
        withPending(
          {
            name: 'Close out',
            state: 'guarded',
            callRef: closeFn.id,
            consequence:
              vaults.length === 0
                ? 'removes this market from your session. Nothing on-chain changes, it has no vaults yet'
                : `removes this market from your session. Its ${vaults.length} vault${vaults.length === 1 ? '' : 's'} stay live on-chain`,
          },
          pendingFor(closeFn)
        )
      )
    }
    focus[marketThingId] = {
      title: short(marketId),
      sub: `open · ${short(marketId)} · ${vaults.length} vault${vaults.length === 1 ? '' : 's'}`,
      verbs,
      history: [`marketId · ${marketId}`],
    }
    for (const v of vaults) {
      const vaultId = v.result?.vaultId ?? ''
      if (vaultId === '') continue
      focus[`vault:${vaultId}`] = {
        title: v.intent?.question ?? short(vaultId),
        sub: `open · ${short(vaultId)}${v.intent?.creatorSide !== undefined ? ` · seeded ${v.intent.creatorSide.toUpperCase()}` : ''}`,
        verbs: [],
        history: [`vault · ${vaultId}`],
      }
    }
  }

  focus.state = {
    title: 'State',
    sub: `${b.lastError !== undefined ? 'error' : 'ready'} · ${pendingWrites} pending write${pendingWrites === 1 ? '' : 's'}`,
    verbs: [],
    history: [
      `runtime · ${b.runtimeId ?? 'unknown'}`,
      ...(b.lastError !== undefined ? [`error · ${b.lastError}`] : []),
    ],
  }

  // --- attention (pointers only, derived) ---
  const attention: AttentionCard[] = []
  if (!hasMarket) {
    attention.push({
      title: 'Add a market',
      detail: 'pick the market to originate vaults on',
      targetId: 'session',
      tone: 'do',
    })
  } else if (vaults.length === 0) {
    attention.push({
      title: `Seed ${short(marketId)}`,
      detail: '0 vaults, bettors have nothing to fund',
      targetId: marketThingId ?? 'session',
      tone: 'do',
    })
  }
  if (b.lastError !== undefined) {
    attention.push({ title: 'Bookmaker error', detail: b.lastError, targetId: 'state', tone: 'err' })
  }
  for (const [fn, target] of [
    [configureFn, 'session'],
    [createVaultFn, marketThingId],
    [closeFn, marketThingId],
  ] as const) {
    const entry = pendingFor(fn)
    if (entry?.phase === 'failed' && fn !== undefined && target !== undefined) {
      attention.push({
        title: `${fn.label} failed`,
        detail: entry.error ?? 'failed',
        targetId: target,
        tone: 'err',
      })
    }
  }

  return {
    role: 'bookmaker',
    things,
    focus,
    attention,
    defaultFocusId: marketThingId ?? 'session',
  }
}
