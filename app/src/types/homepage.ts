/** Homepage card shapes projected from the Host catalog. */

/** Discovery spans all chains; vault tags identify the chain used for signing. */
export type HomepageChain = 'evm' | 'sui' | 'solana'

export interface HomepageStreamCard {
  id: string
  marketId: string
  title: string
  category: string
  activeVaults: number
  /** Effective/live pool (settled + in-flight drip). Host `totalPooled`. */
  totalPooled: number
  /** Settled on-chain pool when host splits it from effective. */
  settledPooled?: number
  elapsed: string
  indexedAtMs?: number
  stale?: boolean
  streamStatus?: 'none' | 'live' | 'ended'
  isLive: boolean
  recordingStatus?: 'recording' | 'processing' | 'ready' | 'failed'
  replay?: { pointerId: string; url: string; format: 'hls'; durationSeconds: number }
  chain?: HomepageChain
}

export interface HomepageLiveVaultCard {
  indexedAtMs?: number
  stale?: boolean
  vaultId: string
  streamId: string
  streamTitle: string
  option: string
  multiplier: number
  /** Effective/live pool (settled + in-flight drip). Host `totalPool`. */
  totalPool: number
  /** Settled on-chain pool when host splits it from effective. */
  settledPool?: number
  status: 'open' | 'hot'
  expiresInSec: number
  chain?: HomepageChain
}

export interface HomepageLifetimeVault {
  indexedAtMs?: number
  stale?: boolean
  streamId?: string
  vaultId: string
  option: string
  streamTitle: string
  outcome: 'yes' | 'no'
  totalPool: number
  resolvedAtMs: number
  chain?: HomepageChain
}

export interface HomepageProtocolStats {
  totalVaults: number
  totalVolume: number
  activeStreams: number
  resolvedVaults: number
  yesWinRatePct: number | null
}

export interface HomepageData {
  indexing?: import('@livestreak/host').CatalogIndexing
  streams: HomepageStreamCard[]
  liveVaults: HomepageLiveVaultCard[]
  lifetimeVaults: HomepageLifetimeVault[]
  protocolStats: HomepageProtocolStats
}
