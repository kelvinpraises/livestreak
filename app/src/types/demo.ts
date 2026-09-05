import type { OptionsVaultPanel, OptionsVaultSide } from '@livestreak/options'

/** Authoritative per-side odds from the options board (one formula for YES & NO). */
export type VaultOdds = OptionsVaultPanel['odds']

export interface WSFrame {
  frame: number
  ts: number
  events: WSEvent[]
  min: number
}

export interface WSEvent {
  id: string
  t: 'alert' | 'vault_created' | 'stream_surge' | 'hot_period' | 'resolved' | 'milestone' | 'system'
  min: number
  desc: string
}

export interface FlowState {
  balance: number
  staked: number
  pendingDividends: number
  totalEarned: number
  apy: number
}

export interface WalletState {
  address: string
  usdcBalance: number
  connected: boolean
  sessionKeySigned: boolean
}

export interface Position {
  vaultId: string
  option: string
  side: OptionsVaultSide
  streamed: number
  streamRate: number
  shares: number
  currentValue: number
  pnl: number
  resolved: boolean
  won?: boolean
  payout?: number
  minute: number
}

export interface VaultView {
  multiplier?: number
  /** Authoritative per-side odds object from the board; render these, never recompute from pools. */
  odds?: VaultOdds
  /** Contracts-blessed hot severity tier: 0 = Warm, 1 = Hot, 2 = Critical. */
  severity?: number
  sharePriceYes?: number
  sharePriceNo?: number
  /** Full-precision USDC pool amounts (floats); replaces the whole-dollar-rounded `OptionsVault.pools`. */
  poolYes?: number
  poolNo?: number
  poolTotal?: number
  fundedSide?: OptionsVaultSide
  userPosition?: { side: OptionsVaultSide; streamed: number; shares: number; currentValue: number }
  userWon?: boolean
  payout?: number
  lvstReceived?: number
  createdMinute?: number
}

export interface StreamMeta {
  id: string
  title: string
  category: string
  activeVaults: number
  totalPooled: number
  elapsed: string
  isLive: boolean
}

export interface FixtureVaultRaw {
  vaultId: string
  marketId: string
  question: string
  type: string
  creator: string
  status: string
  outcome: string
  pools: { yes: number; no: number }
  timing: {
    createdAtAgoMs: number
    expiresAtFromNowMs: number
    resolvedAtAgoMs?: number
  }
  steward: { hot: boolean; hotUntilFromNowMs?: number }
}

export type AgentRole = 'bookmaker' | 'steward' | 'observer'

export interface Agent {
  id: string
  name: string
  address: string
  role: AgentRole
  accuracy: number
  winRate: number
  vaultsCreated: number
  vaultsMonitored: number
  totalVolume: number
  batchesSubmitted?: number
  resolutionsConfirmed?: number
  proposals?: number
  vetosUsed?: number
  uptime?: number
  reputation: number
  successRate?: number
}

export interface HomepageLiveVaultRaw {
  id: string
  streamId: string
  streamTitle: string
  option: string
  multiplier: number
  totalPool: number
  status: 'open' | 'hot'
  expiresIn: number
}

export interface HomepageLifetimeVaultRaw {
  id: string
  option: string
  streamTitle: string
  outcome: 'yes' | 'no'
  totalPool: number
  resolvedAgoMs: number
  yesTotal: number
  noTotal: number
}

export interface HomepageProtocolStatsRaw {
  totalVaults: number
  totalVolume: number
  activeStreams: number
}
