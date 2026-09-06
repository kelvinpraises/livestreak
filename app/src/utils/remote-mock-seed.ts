// A self-contained mock bridge seed driving LocalMockTransport in dev/tests. It mimics
// what the options bridge would advertise as `FunctionDescriptor`s (grouped by target),
// each with a real `inputSchema` so the auto-form renders genuine fields. One function
// is deliberately OUT of the granted scope to prove the in-scope-only rule.

import {
  bridgeActionScope,
  type CallActionEnvelope,
  type FunctionDescriptor,
} from '@livestreak/schema'
import type { MockBridgeSeed, RemoteBoard } from './remote-transport'

const fns: readonly FunctionDescriptor[] = [
  {
    name: 'fundVault',
    label: 'Fund Vault',
    scope: bridgeActionScope,
    target: { kind: 'vault', vaultId: 'vault-01', side: 'yes' },
    disabled: false,
    inputSchema: {
      type: 'object',
      properties: [
        {
          name: 'amountUSDC',
          help: 'USDC to add to the vault',
          value: { type: 'number', description: 'Amount (USDC)', required: true },
        },
        {
          name: 'memo',
          help: 'Optional note recorded with the deposit',
          value: { type: 'string', description: 'Memo' },
        },
      ],
    },
  },
  {
    name: 'setLanes',
    label: 'Set Lanes',
    scope: bridgeActionScope,
    target: { kind: 'nft', tokenId: 'nft-7' },
    disabled: false,
    inputSchema: {
      type: 'object',
      properties: [
        {
          name: 'lane',
          help: 'Which payout lane to route through',
          value: { type: 'enum', description: 'Lane', required: true, values: ['fast', 'standard', 'slow'] },
        },
        {
          name: 'autoCompound',
          help: 'Re-stake yield automatically',
          value: { type: 'boolean', description: 'Auto-compound', default: true },
        },
      ],
    },
  },
  {
    name: 'stakeLvst',
    label: 'Stake $LVST',
    scope: bridgeActionScope,
    target: { kind: 'lvst' },
    disabled: false,
    inputSchema: {
      type: 'object',
      properties: [
        {
          name: 'amount',
          help: 'Whole $LVST to stake',
          value: { type: 'integer', description: 'Amount ($LVST)', required: true },
        },
      ],
    },
  },
  {
    name: 'pauseMarket',
    label: 'Pause Market',
    // Deliberately a DIFFERENT scope than the demo grant carries → must NOT render.
    scope: 'bridge:admin:market',
    target: { kind: 'market', marketId: 'market-01' },
    disabled: false,
    inputSchema: {
      type: 'object',
      properties: [
        {
          name: 'reason',
          help: 'Why the market is being paused',
          value: { type: 'string', description: 'Reason', required: true },
        },
      ],
    },
  },
]

const initialBoard: RemoteBoard = {
  'vault-01': { tvlUSDC: 12500, side: 'yes' },
  'nft-7': { lane: 'standard', autoCompound: true },
  lvst: { staked: 0 },
  calls: [] as string[],
}

const apply = (board: RemoteBoard, envelope: CallActionEnvelope): RemoteBoard => {
  const next: RemoteBoard = { ...board }
  const args = (envelope.args ?? {}) as Record<string, unknown>
  if (envelope.action === 'fundVault') {
    const vault = (next['vault-01'] as Record<string, unknown>) ?? {}
    const add = Number(args.amountUSDC) || 0
    next['vault-01'] = { ...vault, tvlUSDC: (Number(vault.tvlUSDC) || 0) + add }
  } else if (envelope.action === 'setLanes') {
    next['nft-7'] = { lane: args.lane, autoCompound: Boolean(args.autoCompound) }
  } else if (envelope.action === 'stakeLvst') {
    const lvst = (next.lvst as Record<string, unknown>) ?? {}
    next.lvst = { staked: (Number(lvst.staked) || 0) + (Number(args.amount) || 0) }
  }
  next.calls = [...((board.calls as string[]) ?? []), envelope.action]
  return next
}

export const demoMockSeed: MockBridgeSeed = {
  sessionId: 'demo',
  password: 'streak',
  // Grant authorises action-scope functions only — NOT bridge:admin:market.
  grantScopes: [bridgeActionScope],
  functions: fns,
  board: initialBoard,
  apply,
}
