import type { OptionsLaneStatus, OptionsVaultPanel, OptionsVaultSide } from '@livestreak/options'

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
  /** Canonical lane status from the SDK board: streaming | paused | depleted. Single source for the row's
   *  badge/controls — the app no longer re-derives these. Money-driven: paused = stopped but the shared
   *  balance is still there to resume from; depleted = no money left (ran dry or swept to wallet). */
  status: OptionsLaneStatus
  /** CURRENT stream rate in USDC/min (0 when depleted; the resume rate when paused). */
  streamRate: number
  shares: number
  /** This position's share of its side's total shares, as a percent (0–100), from the SDK. Undefined when
   *  the side has no shares yet. Lets the UI show "X% of YES" alongside the raw share count. */
  sharePercent?: number
  resolved: boolean
  won?: boolean
  payout?: number
  /** Loss-mint LVST a losing resolved position can claim (from the lane's `lossClaimableLVST`). Drives the
   *  loss toast's "You received N $LVST". */
  lvstReceived?: number
  minute: number
  /** Runway: ms-since-epoch when this lane's deposit runs dry (streaming only; drives the time-left readout). */
  runwayEndMs?: number
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
  /** rate = the lane's CURRENT stream rate (USDC/min), 0 when depleted. An existing position's slider
   *  seeds from this so it opens at its real rate, not a placeholder. */
  userPosition?: { side: OptionsVaultSide; rate: number; shares: number }
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
  /** Live pool's current growth (USDC/sec) from the SDK sideRate — lets the header tick between polls. */
  totalPooledRatePerSec?: number
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

// The agents-directory row (`Agent`/`AgentRole`) + the homepage `*Raw` item shapes are the
// host discovery CONTRACT — they live in `@livestreak/host` now (single source of truth).
// Re-exported here so existing `#/types/demo` importers keep compiling unchanged.
export type {
  Agent,
  AgentRole,
  HomepageLiveVaultRaw,
  HomepageLifetimeVaultRaw,
  HomepageProtocolStatsRaw,
} from '@livestreak/host'
