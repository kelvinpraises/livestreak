/**
 * Host edge + full app demo fixture shape.
 * Injectable via DEMO EDGE toggle; host `GET /catalog` will match `catalog` + `streams`.
 */

import type {
  Agent,
  FlowState,
  FixtureVaultRaw,
  HomepageLifetimeVaultRaw,
  HomepageLiveVaultRaw,
  HomepageProtocolStatsRaw,
  Position,
  VaultView,
  WalletState,
  WSEvent,
} from '#/types/demo'

export interface HostStreamSummary {
  routeId: string
  marketId: string
  title: string
  category: string
  isLive: boolean
  elapsed?: string
  activeVaults?: number
  totalPooled?: number
}

export interface HostCatalog {
  streams: HostStreamSummary[]
}

export interface HostStreamDetail {
  routeId: string
  marketId: string
  title: string
  category: string
  watchUrl?: string
  isLive: boolean
  activeVaults?: number
  totalPooled?: number
}

export interface AppFixture {
  catalog: HostCatalog
  streams: Record<string, HostStreamDetail>
  agents: Agent[]
  options: {
    vaults: FixtureVaultRaw[]
    vaultViews: Record<string, VaultView>
    events: WSEvent[]
    positions: Position[]
    frame: { frame: number; tsAgoMs: number; events: WSEvent[]; min: number }
    flow: FlowState
    wallet: WalletState
  }
  homepage: {
    liveVaults: HomepageLiveVaultRaw[]
    lifetimeVaults: HomepageLifetimeVaultRaw[]
    protocolStats: HomepageProtocolStatsRaw
  }
}

/** @deprecated alias — same as AppFixture */
export type HostEdgeData = AppFixture
