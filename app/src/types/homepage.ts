/** Homepage card shapes (demo fixture or derived from options panel). */

export interface HomepageStreamCard {
  id: string
  marketId: string
  title: string
  category: string
  activeVaults: number
  totalPooled: number
  elapsed: string
  isLive: boolean
}

export interface HomepageLiveVaultCard {
  vaultId: string
  streamId: string
  streamTitle: string
  option: string
  multiplier: number
  totalPool: number
  status: 'open' | 'hot'
  expiresInSec: number
}

export interface HomepageLifetimeVault {
  vaultId: string
  option: string
  streamTitle: string
  outcome: 'yes' | 'no'
  totalPool: number
  resolvedAtMs: number
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
