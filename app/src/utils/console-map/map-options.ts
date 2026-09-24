// Live mapper: options wire data → ConsoleModel. Board = OptionsBoard {revision, panel, snapshot}
// (duck-typed; packages/options/src/bridge/panel/types.ts is the source of truth). The market card
// IS the position NFT: one NFT per market holds the shared balance every lane streams from, so
// balance/rate/runway live on the market card and low runway means top up THERE.
//
// Fixture → wire reconciliations made here (the flagged UI-impact items):
// - "Back a side" is ONE verb; the wire ships per-side fund descriptors. The verb's callRef is
//   the enabled fund descriptor and the form's side select overrides the descriptor's target side
//   (buildCall lets form values win over target prefill; options-edge routes by action name).
// - Desk membership: vaults you hold a lane on are always present; the Add options picker
//   (localRef, no wire call) adds others — page-local state via input.localPicks.
// - The fixture's chain select inside Stake is DROPPED: a live session runs on the gateway
//   wallet's one chain. Chain shows as state, not a choice.
// - Add market is still a text marketId field: the host market list isn't on the wire yet
//   (host-catalog feed is the noted follow-up).
// - Amounts are base-unit integers matching the wire schemas; human units arrive with the
//   ActionDef phase (defs carry decimals).

import type { FunctionDescriptor } from '@livestreak/schema'
import type {
  AttentionCard,
  ConsoleFocusCard,
  ConsoleThing,
  ConsoleVerb,
  VerbFieldOption,
} from '#/types/console'
import type { PackageMapper, PendingCall } from '#/utils/console-map/types'

export const ADD_OPTIONS_LOCAL_REF = 'options:add-vaults'

// --- board duck types (subset of OptionsPanel) ---

interface LaneView {
  readonly vaultId: string
  readonly side: string
  readonly status: string
  readonly stream: { readonly ratePerMinUSDC: number }
  readonly shares: { readonly accrued: number }
  readonly settlement?: {
    readonly won: boolean
    readonly canClaimWin: boolean
    readonly canClaimLoss: boolean
    readonly claimableUSDC: number
    readonly lossClaimableLVST: number
  }
}

interface NftView {
  readonly tokenId: string
  readonly marketId: string
  readonly lanes: readonly LaneView[]
  readonly account: {
    readonly status: string
    readonly balanceUSDC?: number
    readonly endsAtMs?: number
    readonly drainRatePerSecUSDC?: number
  }
}

interface VaultView {
  readonly vaultId: string
  readonly question: string
  readonly status: string
  readonly pools: { readonly livePoolUSDC: number }
  readonly odds: { readonly yesProbabilityBps: number; readonly noProbabilityBps: number }
  readonly steward: { readonly hot: boolean; readonly hotReason?: string }
}

interface MarketView {
  readonly marketId: string
  readonly title: string
  readonly status: string
  readonly vaults: readonly VaultView[]
}

interface LvstView {
  readonly balanceLVST: number
  readonly stakedLVST: number
  readonly pendingDividendsUSDC: number
}

interface OptionsBoardView {
  readonly revision?: number
  readonly panel?: {
    readonly account?: string
    readonly markets?: readonly MarketView[]
    readonly nfts?: readonly NftView[]
    readonly lvst?: LvstView
  }
}

const asBoard = (board: unknown): OptionsBoardView =>
  board !== null && typeof board === 'object' ? (board as OptionsBoardView) : {}

const short = (hex: string): string => (hex.length > 10 ? `${hex.slice(0, 6)}…` : hex)
const money = (n: number): string => `$${n.toFixed(2)}`

const RUNWAY_WARN_MIN = 15

export const mapOptions: PackageMapper = ({ functions, board, pending, localPicks, nowMs }) => {
  const now = nowMs ?? Date.now()
  const b = asBoard(board)
  const panel = b.panel ?? {}
  const account = panel.account ?? ''
  const markets = panel.markets ?? []
  const nfts = panel.nfts ?? []

  const fnWhere = (pred: (fn: FunctionDescriptor) => boolean): FunctionDescriptor | undefined =>
    functions.find(pred)
  const pendingFor = (fn: FunctionDescriptor | undefined): PendingCall | undefined =>
    fn === undefined ? undefined : pending.get(fn.id)
  const withPending = (verb: ConsoleVerb, entry: PendingCall | undefined): ConsoleVerb => {
    if (entry === undefined) return verb
    if (entry.phase === 'failed') return { ...verb, state: 'failed', reason: entry.error }
    return { ...verb, state: 'busy' }
  }
  const verbFor = (fn: FunctionDescriptor | undefined, verb: Omit<ConsoleVerb, 'callRef'>): ConsoleVerb | undefined =>
    fn === undefined ? undefined : withPending({ ...verb, callRef: fn.id }, pendingFor(fn))

  const configureFn = fnWhere((f) => f.name === 'configure')
  const closeFn = fnWhere((f) => f.name === 'close')

  const things: ConsoleThing[] = []
  const focus: Record<string, ConsoleFocusCard> = {}
  const attention: AttentionCard[] = []

  // --- session ---
  things.push({
    id: 'session',
    kind: 'session',
    label: 'Session',
    note: markets.length > 0 ? `${markets.length} market${markets.length === 1 ? '' : 's'}` : 'no market yet',
    tone: 'ok',
  })
  const addMarket = verbFor(configureFn, {
    name: 'Add market',
    state: 'ready',
    ...(markets.length === 0 ? { hot: true } : {}),
    // Host market list is not on the wire yet — a raw marketId field until that feed lands.
    fields: [{ name: 'marketId', value: '' }],
  })
  focus.session = {
    title: 'Session',
    sub: `connected · ${account === '' ? 'options' : short(account)}`,
    verbs: addMarket === undefined ? [] : [addMarket],
  }
  if (markets.length === 0) {
    attention.push({
      title: 'Add a market',
      detail: 'pick the market to play',
      targetId: 'session',
      tone: 'do',
    })
  }

  // --- markets (each card = the position NFT when entered) ---
  for (const m of markets) {
    const marketThingId = `market:${m.marketId}`
    const nft = nfts.find((n) => n.marketId === m.marketId)
    const laneByVault = new Map((nft?.lanes ?? []).map((l) => [l.vaultId, l]))
    const runwayMin =
      nft?.account.endsAtMs !== undefined && nft.account.status === 'streaming'
        ? Math.max(0, Math.round((nft.account.endsAtMs - now) / 60_000))
        : undefined
    const runwayLow = runwayMin !== undefined && runwayMin < RUNWAY_WARN_MIN
    const ratePerMin =
      nft?.account.drainRatePerSecUSDC !== undefined ? nft.account.drainRatePerSecUSDC * 60 : undefined

    things.push({
      id: marketThingId,
      parentId: 'session',
      kind: 'market',
      label: m.title,
      note:
        nft === undefined
          ? `${m.vaults.length} vault${m.vaults.length === 1 ? '' : 's'}`
          : runwayLow
            ? `runway ${runwayMin}m`
            : nft.account.status,
      tone: runwayLow ? 'warn' : 'ok',
    })

    const mintFn = fnWhere((f) => f.name === 'mint' && f.target?.marketId === m.marketId)
    const addFundsFn = fnWhere((f) => f.name === 'addFunds' && f.target?.tokenId === nft?.tokenId)
    const sweepFn = fnWhere((f) => f.name === 'stopAllFunding' && f.target?.tokenId === nft?.tokenId)

    const verbs: ConsoleVerb[] = []
    if (nft === undefined) {
      const enter = verbFor(mintFn, {
        name: 'Enter market',
        state: mintFn?.disabled === true ? 'locked' : 'ready',
        ...(mintFn?.disabled === true ? { hint: mintFn.disabledReason ?? 'unavailable' } : { hot: true }),
        presetArgs: { to: account },
      })
      if (enter !== undefined) verbs.push(enter)
    } else {
      verbs.push({
        // Local action: edits desk membership only, no wire call. Options carry the vaultId as
        // their submit value so the page stores ids, not question text.
        name: 'Add options',
        state: 'ready',
        localRef: ADD_OPTIONS_LOCAL_REF,
        fields: [
          {
            name: 'options',
            value: '',
            kind: 'picker',
            multi: true,
            options: m.vaults
              .map((v): VerbFieldOption => {
                const added = laneByVault.has(v.vaultId) || (localPicks?.has(v.vaultId) ?? false)
                const open = v.status === 'open' || v.status === 'hot'
                return {
                  label: v.question,
                  value: v.vaultId,
                  note: added ? 'added' : open ? 'open' : v.status,
                  disabled: added || !open,
                }
              })
              .sort((a, b) => Number(a.disabled ?? false) - Number(b.disabled ?? false)),
          },
        ],
      })
      const addFunds = verbFor(addFundsFn, {
        name: 'Add funds',
        state: 'ready',
        ...(runwayLow ? { hot: true } : {}),
        fields: [{ name: 'deposit · base units', arg: 'deposit', value: '', kind: 'number' }],
      })
      if (addFunds !== undefined) verbs.push(addFunds)
      const sweep = verbFor(sweepFn, {
        name: 'Sweep to wallet',
        state: sweepFn?.disabled === true ? 'locked' : 'ready',
        ...(sweepFn?.disabled === true ? { hint: sweepFn.disabledReason ?? 'nothing to sweep' } : {}),
      })
      if (sweep !== undefined) verbs.push(sweep)
    }
    const closeOut = verbFor(closeFn, {
      name: 'Close out',
      state: 'guarded',
      consequence:
        nft === undefined
          ? 'removes this market from your session. Nothing on-chain changes'
          : 'removes this market from your session. Lanes keep streaming until stopped; resolved claims stay claimable',
    })
    if (closeOut !== undefined) verbs.push(closeOut)

    focus[marketThingId] = {
      title: m.title,
      sub:
        nft === undefined
          ? `${m.status} · ${m.vaults.length} vault${m.vaults.length === 1 ? '' : 's'} · not entered`
          : [
              'entered',
              `NFT #${short(nft.tokenId)}`,
              ...(nft.account.balanceUSDC !== undefined ? [`balance ${money(nft.account.balanceUSDC)}`] : []),
              ...(ratePerMin !== undefined && ratePerMin > 0 ? [`streaming ${money(ratePerMin)}/min`] : []),
              ...(runwayMin !== undefined ? [`runway ${runwayMin}m`] : []),
            ].join(' · '),
      verbs,
    }

    if (nft === undefined && m.vaults.length > 0) {
      attention.push({
        title: `Enter ${m.title}`,
        detail: 'mint the position NFT to start backing sides',
        targetId: marketThingId,
        tone: 'do',
      })
    }
    if (runwayLow) {
      attention.push({
        title: 'Position runway low',
        detail: `${runwayMin} min left, top up?`,
        targetId: marketThingId,
        tone: 'do',
      })
    }

    // --- vaults on the desk: held lanes always, picker additions on top ---
    const onDesk = m.vaults.filter(
      (v) => laneByVault.has(v.vaultId) || (localPicks?.has(v.vaultId) ?? false)
    )
    for (const v of onDesk) {
      const vaultThingId = `vault:${v.vaultId}`
      const lane = laneByVault.get(v.vaultId)
      const yesPct = Math.round(v.odds.yesProbabilityBps / 100)
      const noPct = Math.round(v.odds.noProbabilityBps / 100)

      things.push({
        id: vaultThingId,
        parentId: marketThingId,
        kind: 'vault',
        label: v.question,
        note: v.steward.hot ? 'hot' : lane !== undefined ? lane.status : v.status,
        tone: v.steward.hot ? 'warn' : 'ok',
      })
      if (v.steward.hot) {
        attention.push({
          title: 'Vault is hot',
          detail: v.steward.hotReason ?? v.question,
          targetId: vaultThingId,
          tone: 'wait',
        })
      }

      const vaultVerbs: ConsoleVerb[] = []
      const fundYes = fnWhere((f) => f.name === 'fund' && f.target?.vaultId === v.vaultId && f.target.side === 'yes')
      const fundNo = fnWhere((f) => f.name === 'fund' && f.target?.vaultId === v.vaultId && f.target.side === 'no')
      const fundFn = [fundYes, fundNo].find((f) => f !== undefined && !f.disabled) ?? fundYes ?? fundNo
      if (fundFn !== undefined && nft !== undefined) {
        const backASide = verbFor(fundFn, {
          name: 'Back a side',
          state: fundFn.disabled ? 'locked' : 'ready',
          ...(fundFn.disabled
            ? { hint: fundFn.disabledReason ?? 'unavailable' }
            : {
                hot: true,
                fields: [
                  { name: 'side', value: fundFn.target?.side ?? 'yes', kind: 'select', options: [{ label: 'yes' }, { label: 'no' }] },
                  { name: 'rate · base units/s', arg: 'rate', value: '', kind: 'number' },
                  { name: 'deposit · base units', arg: 'deposit', value: '', kind: 'number' },
                ],
                presetArgs: { tokenId: nft.tokenId },
              }),
        })
        if (backASide !== undefined) vaultVerbs.push(backASide)
      }
      const withdrawFn = fnWhere((f) => f.name === 'withdraw' && f.target?.vaultId === v.vaultId)
      if (withdrawFn !== undefined && nft !== undefined) {
        const canClaim = !withdrawFn.disabled
        const withdraw = verbFor(withdrawFn, {
          name: canClaim && lane?.settlement !== undefined ? `Withdraw ${money(lane.settlement.claimableUSDC)}` : 'Withdraw',
          state: canClaim ? 'ready' : 'locked',
          ...(canClaim
            ? { presetArgs: { tokenId: nft.tokenId, to: account } }
            : { hint: `${withdrawFn.disabledReason ?? 'nothing to claim'} · waiting on steward` }),
        })
        if (withdraw !== undefined) vaultVerbs.push(withdraw)
        if (canClaim) {
          attention.push({
            title: 'Winnings claimable',
            detail: `${v.question} · ${money(lane?.settlement?.claimableUSDC ?? 0)}`,
            targetId: vaultThingId,
            tone: 'good',
          })
        }
      }
      const claimLossFn = fnWhere((f) => f.name === 'claimLossLvst' && f.target?.vaultId === v.vaultId)
      if (claimLossFn !== undefined && !claimLossFn.disabled && nft !== undefined) {
        const claimLoss = verbFor(claimLossFn, {
          name: `Claim ${(lane?.settlement?.lossClaimableLVST ?? 0).toFixed(1)} LVST`,
          state: 'ready',
          presetArgs: { tokenId: nft.tokenId, to: account },
        })
        if (claimLoss !== undefined) vaultVerbs.push(claimLoss)
      }

      focus[vaultThingId] = {
        title: v.question,
        sub: `YES ${yesPct}% · NO ${noPct}% · ${money(v.pools.livePoolUSDC)} pooled`,
        verbs: vaultVerbs,
        ...(lane !== undefined
          ? {
              history: [
                `your side · ${lane.side.toUpperCase()} · ${money(lane.stream.ratePerMinUSDC)}/min`,
                `streamed · ${lane.shares.accrued.toFixed(1)} sh`,
              ],
            }
          : {}),
      }
    }

    // Waiting on steward: you hold a lane on an unresolved vault — winnings locked until resolution.
    const unresolved = onDesk.find(
      (v) => laneByVault.has(v.vaultId) && v.status !== 'resolved' && laneByVault.get(v.vaultId)?.settlement === undefined
    )
    if (unresolved !== undefined) {
      attention.push({
        title: 'Waiting on steward',
        detail: 'positions settle when vaults resolve',
        targetId: `vault:${unresolved.vaultId}`,
        tone: 'wait',
      })
    }
  }

  // --- LVST (wallet-level root, chain is session state not a choice) ---
  const lvst = panel.lvst
  if (lvst !== undefined) {
    const stakeFn = fnWhere((f) => f.name === 'stakeLvst')
    const unstakeFn = fnWhere((f) => f.name === 'unstakeLvst')
    const dividendsFn = fnWhere((f) => f.name === 'claimDividends')
    things.push({ id: 'lvst', kind: 'lvst', label: 'LVST', note: `${lvst.stakedLVST} staked`, tone: 'ok' })
    const lvstVerbs: ConsoleVerb[] = []
    const stake = verbFor(stakeFn, {
      name: 'Stake',
      state: stakeFn?.disabled === true ? 'locked' : 'ready',
      ...(stakeFn?.disabled === true
        ? { hint: stakeFn.disabledReason ?? 'nothing to stake' }
        : { fields: [{ name: 'amount · base units', arg: 'amount', value: '', kind: 'number' }] }),
    })
    if (stake !== undefined) lvstVerbs.push(stake)
    const unstake = verbFor(unstakeFn, {
      name: 'Unstake',
      state: unstakeFn?.disabled === true ? 'locked' : 'ready',
      ...(unstakeFn?.disabled === true
        ? { hint: unstakeFn.disabledReason ?? 'nothing staked' }
        : { fields: [{ name: 'amount · base units', arg: 'amount', value: '', kind: 'number' }] }),
    })
    if (unstake !== undefined) lvstVerbs.push(unstake)
    const dividends = verbFor(dividendsFn, {
      name: 'Claim dividends',
      state: dividendsFn?.disabled === true ? 'locked' : 'ready',
      ...(dividendsFn?.disabled === true ? { hint: dividendsFn.disabledReason ?? 'none pending' } : {}),
    })
    if (dividends !== undefined) lvstVerbs.push(dividends)
    focus.lvst = {
      title: 'LVST',
      sub: `${lvst.balanceLVST.toFixed(2)} LVST · ${lvst.stakedLVST.toFixed(2)} staked · ${money(lvst.pendingDividendsUSDC)} dividends pending`,
      verbs: lvstVerbs,
    }
  }

  // --- state root ---
  // No revision in the model (it defeats render stabilization) — the gear drawer shows it raw.
  things.push({
    id: 'state',
    kind: 'state',
    label: 'State',
    note: 'polling 3s',
    tone: 'idle',
  })
  focus.state = {
    title: 'State',
    sub: 'live · polling 3s',
    verbs: [],
    history: [...(account !== '' ? [`account · ${account}`] : []), 'polling · 3s'],
  }

  // Failed pending calls: point at the thing carrying the verb.
  for (const [ref, entry] of pending) {
    if (entry.phase !== 'failed') continue
    const fn = functions.find((f) => f.id === ref)
    if (fn === undefined) continue
    const targetId =
      fn.target?.vaultId !== undefined && focus[`vault:${fn.target.vaultId}`] !== undefined
        ? `vault:${fn.target.vaultId}`
        : fn.target?.marketId !== undefined && focus[`market:${fn.target.marketId}`] !== undefined
          ? `market:${fn.target.marketId}`
          : fn.target?.kind === 'lvst'
            ? 'lvst'
            : 'session'
    attention.push({
      title: `${fn.label} failed`,
      detail: entry.error ?? 'failed',
      targetId,
      tone: 'err',
    })
  }

  const firstMarket = markets[0]
  return {
    role: 'options',
    things,
    focus,
    attention,
    defaultFocusId: firstMarket !== undefined ? `market:${firstMarket.marketId}` : 'session',
  }
}
