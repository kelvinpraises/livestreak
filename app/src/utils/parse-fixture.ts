import type { OptionsVault } from '@livestreak/options'
import { asMarketId, asVaultId } from '@livestreak/options'

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

  const resolved = f.homepage.lifetimeVaults.length
  const yesWins = f.homepage.lifetimeVaults.filter(v => v.outcome === 'yes').length

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
    homepage: {
      streams: f.catalog.streams.map(s => ({
        id: s.routeId,
        marketId: s.marketId,
        title: s.title,
        category: s.category,
        activeVaults: s.activeVaults ?? 0,
        totalPooled: s.totalPooled ?? 0,
        elapsed: s.elapsed ?? '',
        isLive: s.isLive,
      })),
      liveVaults: f.homepage.liveVaults.map(v => ({
        vaultId: v.id,
        streamId: v.streamId,
        streamTitle: v.streamTitle,
        option: v.option,
        multiplier: v.multiplier,
        totalPool: v.totalPool,
        status: v.status,
        expiresInSec: v.expiresIn,
      })),
      lifetimeVaults: f.homepage.lifetimeVaults.map(({ resolvedAgoMs, ...v }) => ({
        vaultId: v.id,
        option: v.option,
        streamTitle: v.streamTitle,
        outcome: v.outcome,
        totalPool: v.totalPool,
        resolvedAtMs: Date.now() - resolvedAgoMs,
      })),
      protocolStats: {
        totalVaults: f.homepage.protocolStats.totalVaults,
        totalVolume: f.homepage.protocolStats.totalVolume,
        activeStreams: f.homepage.protocolStats.activeStreams,
        resolvedVaults: resolved,
        yesWinRatePct: resolved > 0 ? Math.round((yesWins / resolved) * 100) : null,
      },
    },
  }
}
