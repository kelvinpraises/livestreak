/** Homepage card shapes (demo fixture or derived from options panel). */

/** Chain tag carried through from the host catalog so the homepage can scope rails by the
 *  active chain. Optional because the demo fixture predates the tag (it is never chain-filtered). */
export type HomepageChain = 'evm' | 'sui'

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
  isLive: boolean
  chain?: HomepageChain
}

export interface HomepageLiveVaultCard {
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
  streams: HomepageStreamCard[]
  liveVaults: HomepageLiveVaultCard[]
  lifetimeVaults: HomepageLifetimeVault[]
  protocolStats: HomepageProtocolStats
}
