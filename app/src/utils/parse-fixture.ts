import type { OptionsVault } from '@livestreak/options'
import { asMarketId, asVaultId } from '@livestreak/options'

import { hostHomepageToCards } from '#/utils/host'
import type { AppFixture } from '#/types/host-edge'
import type {
  Agent,
  FlowState,
  Position,
  StreamMeta,
  VaultView,
  WalletState,
  WSFrame,
  WSEvent,
} from '#/types/demo'
import type { HomepageData } from '#/types/homepage'

export interface ParsedFixture {
  vaults: OptionsVault[]
  vaultViews: Record<string, VaultView>
  events: WSEvent[]
  flow: FlowState
  wallet: WalletState
  positions: Position[]
  frame: WSFrame
  streams: StreamMeta[]
  agents: Agent[]
  homepage: HomepageData
}

export function parseFixture(f: AppFixture): ParsedFixture {
  const vaults: OptionsVault[] = f.options.vaults.map(v => ({
    vaultId: asVaultId(v.vaultId),
    marketId: asMarketId(v.marketId),
    question: v.question,
    type: v.type,
    creator: v.creator,
    status: v.status as OptionsVault['status'],
    outcome: v.outcome as OptionsVault['outcome'],
    pools: { yes: BigInt(v.pools.yes), no: BigInt(v.pools.no) },
    timing: {
      createdAtMs: Date.now() - v.timing.createdAtAgoMs,
      expiresAtMs: Date.now() + v.timing.expiresAtFromNowMs,
      ...(v.timing.resolvedAtAgoMs !== undefined
        ? { resolvedAtMs: Date.now() - v.timing.resolvedAtAgoMs }
        : {}),
    },
    steward: {
      hot: v.steward.hot,
      ...(v.steward.hotUntilFromNowMs !== undefined
        ? { hotUntilMs: Date.now() + v.steward.hotUntilFromNowMs }
        : {}),
    },
  }))

  return {
    vaults,
    vaultViews: { ...f.options.vaultViews },
    events: f.options.events,
    flow: f.options.flow,
    wallet: f.options.wallet,
    positions: f.options.positions,
    frame: {
      ...f.options.frame,
      ts: Date.now() - f.options.frame.tsAgoMs,
    },
    streams: f.catalog.streams.map(s => ({
      id: s.routeId,
      title: s.title,
      category: s.category,
      activeVaults: s.activeVaults ?? 0,
      totalPooled: s.totalPooled ?? 0,
      elapsed: s.elapsed ?? '',
      isLive: s.isLive,
    })),
    agents: f.agents,
    // Same raw->card projection the LIVE host path uses (utils/host.ts). The streams rail comes
    // from the fixture catalog; the vault rails + stats from the fixture homepage payload.
    homepage: hostHomepageToCards({
      streams: f.catalog.streams,
      liveVaults: f.homepage.liveVaults,
      lifetimeVaults: f.homepage.lifetimeVaults,
      protocolStats: f.homepage.protocolStats,
    }),
  }
}
