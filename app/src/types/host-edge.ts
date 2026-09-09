/**
 * App DEMO-EDGE fixture shape + thin re-exports of the host discovery contract.
 *
 * The discovery CONTRACT types (HostStreamSummary / HostStreamDetail / HostCatalog + the
 * `Homepage*Raw` item shapes + `Agent`) now live in `@livestreak/host` as the SINGLE
 * SOURCE OF TRUTH (agent-2 moved them there). We re-export them here so existing
 * `#/types/host-edge` importers keep compiling, but there is no local duplicate anymore.
 * The host shapes are a non-breaking superset (each item carries a `chain` tag) — the app
 * reads them and ignores unknown fields.
 */

export type {
  HostStreamSummary,
  HostStreamDetail,
  HostCatalog,
  HomepageData as HostHomepageData,
  AgentsData as HostAgentsData,
  HomepageLiveVaultRaw,
  HomepageLifetimeVaultRaw,
  HomepageProtocolStatsRaw,
  CatalogChain,
} from '@livestreak/host'

import type {
  HostStreamDetail,
  HostStreamSummary,
  HomepageLifetimeVaultRaw,
  HomepageLiveVaultRaw,
  HomepageProtocolStatsRaw,
} from '@livestreak/host'
import type {
  Agent,
  FlowState,
  FixtureVaultRaw,
  Position,
  VaultView,
  WalletState,
  WSEvent,
} from '#/types/demo'

/**
 * The full app demo fixture (injectable via the DEMO EDGE toggle). Its discovery sub-shapes
 * (`catalog` / `streams` / `homepage` items) reuse the `@livestreak/host` contract types.
 */
export interface AppFixture {
  catalog: { streams: HostStreamSummary[] }
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
