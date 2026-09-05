import type { OptionsVault } from '@livestreak/options'
import { asMarketId, asVaultId } from '@livestreak/options'

import { defaultHostEdgeFixture } from '#/utils/demo'
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

const f = defaultHostEdgeFixture

export type {
  Agent,
  AgentRole,
  FlowState,
  Position,
  StreamMeta,
  VaultView,
  WalletState,
  WSFrame,
  WSEvent,
} from '#/types/demo'

export const mockVaults: OptionsVault[] = f.options.vaults.map(v => ({
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

export const mockVaultViews: Record<string, VaultView> = { ...f.options.vaultViews }

export const mockEvents: WSEvent[] = f.options.events

export const mockFlow: FlowState = f.options.flow

export const mockWallet: WalletState = f.options.wallet

export const mockPositions: Position[] = f.options.positions

export const mockFrame: WSFrame = {
  ...f.options.frame,
  ts: Date.now() - f.options.frame.tsAgoMs,
}

export const mockStreams: StreamMeta[] = f.catalog.streams.map(s => ({
  id: s.routeId,
  title: s.title,
  category: s.category,
  activeVaults: s.activeVaults ?? 0,
  totalPooled: s.totalPooled ?? 0,
  elapsed: s.elapsed ?? '',
  isLive: s.isLive,
}))

export const mockAgents: Agent[] = f.agents

export const mockLiveVaults = f.homepage.liveVaults
export const mockLifetimeVaults = f.homepage.lifetimeVaults.map(
  ({ resolvedAgoMs, ...v }) => ({ ...v, resolvedAt: Date.now() - resolvedAgoMs }),
)
export const mockProtocolStats = f.homepage.protocolStats
