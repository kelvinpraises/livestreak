// Golden test for the options mapper: wire-shaped functions[] + OptionsBoard → ConsoleModel.
// Function/board shapes mirror packages/options/src/bridge/panel/{descriptors,types}.ts. The
// UI-impact reconciliations under test: market card = the position NFT (balance/rate/runway),
// ONE Back-a-side verb over per-side fund descriptors, desk membership = held lanes + picks,
// runway warning justified by note + attention card.

import { describe, expect, it } from 'vitest'
import type { FunctionDescriptor } from '@livestreak/schema'
import { mapOptions } from '../src/utils/console-map/map-options'
import { buildCall } from '../src/utils/console-dispatch'
import type { PendingCall } from '../src/utils/console-map/types'
import { consoleModelViolations } from './helpers/console-invariants'

const MARKET = '0x2669e60cf22c8f8bd2d1a9f7203e59a921bd66c96626e0864a5d1e4478d34ed8'
const VAULT_A = '0x39e9aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22aa33bb44cc55'
const VAULT_B = '0x7b1200aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22aa33bb44cc'
const TOKEN = '189178232373'
const ACCOUNT = '0xAbCd000000000000000000000000000000000001'
const NOW = 1_700_000_000_000

const FUND_SCHEMA = {
  type: 'object' as const,
  properties: [
    { name: 'tokenId', value: { type: 'string' as const, required: true, format: 'bigint' as const }, help: '' },
    { name: 'vaultId', value: { type: 'string' as const, required: true }, help: '' },
    { name: 'side', value: { type: 'enum' as const, required: true, values: ['yes', 'no'] }, help: '' },
    { name: 'rate', value: { type: 'string' as const, required: true, format: 'bigint' as const }, help: '' },
    { name: 'deposit', value: { type: 'string' as const, required: true, format: 'bigint' as const }, help: '' },
  ],
}

const fn = (over: Partial<FunctionDescriptor> & Pick<FunctionDescriptor, 'id' | 'name'>): FunctionDescriptor => ({
  package: 'options',
  label: over.name,
  scope: `bridge:action:${over.name}`,
  disabled: false,
  ...over,
})

const wireFunctions: FunctionDescriptor[] = [
  fn({ id: 'options.config.configure', name: 'configure', label: 'Configure options' }),
  fn({ id: 'options.config.close', name: 'close', label: 'Close' }),
  fn({
    id: `options.root.action.mint.${MARKET}`,
    name: 'mint',
    label: 'Mint',
    target: { kind: 'market', marketId: MARKET },
    disabled: true,
    disabledReason: 'Already entered this market',
  }),
  fn({
    id: `options.root.action.fund.${VAULT_A}.yes`,
    name: 'fund',
    label: 'Fund YES',
    target: { kind: 'vault', marketId: MARKET, vaultId: VAULT_A, side: 'yes' },
    inputSchema: FUND_SCHEMA,
  }),
  fn({
    id: `options.root.action.fund.${VAULT_A}.no`,
    name: 'fund',
    label: 'Fund NO',
    target: { kind: 'vault', marketId: MARKET, vaultId: VAULT_A, side: 'no' },
    inputSchema: FUND_SCHEMA,
  }),
  fn({
    id: `options.root.action.fund.${VAULT_B}.yes`,
    name: 'fund',
    label: 'Fund YES',
    target: { kind: 'vault', marketId: MARKET, vaultId: VAULT_B, side: 'yes' },
    disabled: true,
    disabledReason: 'Vault already funded (one side per vault) — stop or adjust lanes to change',
    inputSchema: FUND_SCHEMA,
  }),
  fn({
    id: `options.root.action.withdraw.${VAULT_B}`,
    name: 'withdraw',
    label: 'Withdraw',
    target: { kind: 'vault', marketId: MARKET, vaultId: VAULT_B },
    disabled: true,
    disabledReason: 'No winnings to claim',
  }),
  fn({
    id: `options.root.action.addFunds.${TOKEN}`,
    name: 'addFunds',
    label: 'Add funds',
    target: { kind: 'nft', marketId: MARKET, tokenId: TOKEN },
  }),
  fn({
    id: `options.root.action.stopAllFunding.${TOKEN}`,
    name: 'stopAllFunding',
    label: 'Sweep',
    target: { kind: 'nft', marketId: MARKET, tokenId: TOKEN },
  }),
  fn({ id: 'options.root.action.stakeLvst', name: 'stakeLvst', label: 'Stake LVST', target: { kind: 'lvst' } }),
  fn({
    id: 'options.root.action.unstakeLvst',
    name: 'unstakeLvst',
    label: 'Unstake LVST',
    target: { kind: 'lvst' },
    disabled: true,
    disabledReason: 'Nothing staked',
  }),
]

const boardFixture = {
  revision: 42,
  panel: {
    account: ACCOUNT,
    markets: [
      {
        marketId: MARKET,
        title: 'Board Clunk Demo',
        status: 'open',
        vaults: [
          {
            vaultId: VAULT_A,
            question: 'Will there be a goal?',
            status: 'open',
            pools: { livePoolUSDC: 140.37 },
            odds: { yesProbabilityBps: 6400, noProbabilityBps: 3600 },
            steward: { hot: false },
          },
          {
            vaultId: VAULT_B,
            question: 'Will there be a red card?',
            status: 'open',
            pools: { livePoolUSDC: 88.2 },
            odds: { yesProbabilityBps: 5000, noProbabilityBps: 5000 },
            steward: { hot: false },
          },
        ],
      },
    ],
    nfts: [
      {
        tokenId: TOKEN,
        marketId: MARKET,
        lanes: [
          {
            vaultId: VAULT_B,
            side: 'yes',
            status: 'streaming',
            stream: { ratePerMinUSDC: 1.5 },
            shares: { accrued: 12.4 },
          },
        ],
        account: {
          status: 'streaming',
          balanceUSDC: 27.78,
          endsAtMs: NOW + 12 * 60_000, // 12 minutes of runway → warn
          drainRatePerSecUSDC: 0.025,
        },
      },
    ],
    lvst: { balanceLVST: 845.49, stakedLVST: 0, pendingDividendsUSDC: 0 },
  },
}

const NONE: ReadonlyMap<string, PendingCall> = new Map()

describe('mapOptions', () => {
  const model = mapOptions({
    functions: wireFunctions,
    board: boardFixture,
    pending: NONE,
    localPicks: new Set([VAULT_A]),
    nowMs: NOW,
  })

  it('honors the ConsoleModel contract', () => {
    expect(consoleModelViolations(model)).toEqual([])
  })

  it('market card IS the position NFT: balance, rate, runway in the sub; low runway warns', () => {
    const market = model.things.find((t) => t.kind === 'market')
    expect(market).toMatchObject({ id: `market:${MARKET}`, label: 'Board Clunk Demo', tone: 'warn', note: 'runway 12m' })
    const sub = model.focus[`market:${MARKET}`]?.sub ?? ''
    expect(sub).toContain('entered')
    expect(sub).toContain('$27.78')
    expect(sub).toContain('$1.50/min')
    expect(sub).toContain('runway 12m')
    expect(model.attention.find((a) => a.title === 'Position runway low')).toMatchObject({
      targetId: `market:${MARKET}`,
      tone: 'do',
    })
    // Runway low → Add funds is the suggested next action.
    const addFunds = model.focus[`market:${MARKET}`]?.verbs.find((v) => v.name === 'Add funds')
    expect(addFunds).toMatchObject({ hot: true, callRef: `options.root.action.addFunds.${TOKEN}` })
  })

  it('desk membership: held-lane vault always present, picked vault added, others absent', () => {
    const vaultIds = model.things.filter((t) => t.kind === 'vault').map((t) => t.id)
    expect(vaultIds).toContain(`vault:${VAULT_B}`) // held lane
    expect(vaultIds).toContain(`vault:${VAULT_A}`) // local pick
  })

  it('ONE Back-a-side verb: enabled fund descriptor as callRef, side select, tokenId preset', () => {
    const back = model.focus[`vault:${VAULT_A}`]?.verbs.find((v) => v.name === 'Back a side')
    expect(back).toMatchObject({ state: 'ready', hot: true, callRef: `options.root.action.fund.${VAULT_A}.yes` })
    expect(back?.presetArgs).toEqual({ tokenId: TOKEN })
    const sideField = back?.fields?.find((f) => f.name === 'side')
    expect(sideField?.options?.map((o) => o.label)).toEqual(['yes', 'no'])

    // Funded vault: locked with the package's own reason.
    const backB = model.focus[`vault:${VAULT_B}`]?.verbs.find((v) => v.name === 'Back a side')
    expect(backB?.state).toBe('locked')
    expect(backB?.hint).toContain('already funded')
  })

  it('the form side select overrides the per-side descriptor target through buildCall', () => {
    const fundYes = wireFunctions.find((f) => f.id === `options.root.action.fund.${VAULT_A}.yes`)
    const back = model.focus[`vault:${VAULT_A}`]?.verbs.find((v) => v.name === 'Back a side')
    if (fundYes === undefined || back === undefined) throw new Error('missing fixtures')
    const built = buildCall(fundYes, back, {
      side: 'no',
      'rate · base units/s': '10000',
      'deposit · base units': '30000000',
    })
    expect(built.ok).toBe(true)
    expect(built.envelope?.args).toMatchObject({
      side: 'no', // the form beat the target's side=yes
      vaultId: VAULT_A, // target prefill still supplies what the form doesn't
      tokenId: '189178232373', // presetArgs (bigint-coerced downstream by the bridge)
      rate: '10000',
      deposit: '30000000',
    })
  })

  it('waiting-on-steward wait card targets the held unresolved vault', () => {
    expect(model.attention.find((a) => a.tone === 'wait')).toMatchObject({ targetId: `vault:${VAULT_B}` })
  })

  it('LVST is a root with stake ready and unstake locked by the package reason', () => {
    const lvst = model.things.find((t) => t.kind === 'lvst')
    expect(lvst?.parentId).toBeUndefined()
    const verbs = model.focus.lvst?.verbs ?? []
    expect(verbs.find((v) => v.name === 'Stake')?.state).toBe('ready')
    expect(verbs.find((v) => v.name === 'Unstake')).toMatchObject({ state: 'locked', hint: 'Nothing staked' })
    // The fixture's chain select is gone: a live session is single-chain.
    expect(verbs.find((v) => v.name === 'Stake')?.fields?.some((f) => f.name === 'chain')).toBe(false)
  })

  it('not entered: mint is the hot verb and an enter do-card points at the market', () => {
    const noNft = {
      ...boardFixture,
      panel: { ...boardFixture.panel, nfts: [] },
    }
    const fns = wireFunctions.map((f) => (f.name === 'mint' ? { ...f, disabled: false, disabledReason: undefined } : f))
    const m = mapOptions({ functions: fns, board: noNft, pending: NONE, nowMs: NOW })
    expect(consoleModelViolations(m)).toEqual([])
    const enter = m.focus[`market:${MARKET}`]?.verbs.find((v) => v.name === 'Enter market')
    expect(enter).toMatchObject({ state: 'ready', hot: true })
    expect(enter?.presetArgs).toEqual({ to: ACCOUNT })
    expect(m.attention.find((a) => a.title.startsWith('Enter'))).toBeDefined()
  })
})
