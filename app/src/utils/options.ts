import type {
  OptionsFunctionView,
  OptionsMarketPanel,
  OptionsPanel,
  OptionsVault,
  OptionsVaultPanel,
} from '@livestreak/options'
import type {
  HomepageData,
  HomepageLifetimeVault,
  HomepageLiveVaultCard,
  HomepageStreamCard,
} from '#/types/homepage'
import { SHARE_SCALE, asMarketId, asVaultId } from '@livestreak/options'

import type { FlowState, Position, VaultView } from '#/types/demo'
import type { OptionsChainKind } from '#/utils/chain'
import type { StreamPointer } from '#/utils/stream'

const USDC_SCALE = 1_000_000

// LVST decimals are chain-LOCAL (contracts D2 decision): EVM = 18, Sui = 9. The display scale MUST be
// resolved per active chain — a single hardcoded 1e18 renders Sui LVST 1e9× too small.
const LVST_SCALE_BY_CHAIN: Record<OptionsChainKind, number> = {
  evm: 1_000_000_000_000_000_000, // 1e18
  sui: 1_000_000_000, // 1e9
}

export function usdcStringToNumber(value: string): number {
  return Number(BigInt(value)) / USDC_SCALE
}

export function shareStringToNumber(value: string): number {
  return Number(BigInt(value)) / Number(SHARE_SCALE)
}

function lvstStringToNumber(value: string, chain: OptionsChainKind): number {
  return Number(BigInt(value)) / LVST_SCALE_BY_CHAIN[chain]
}

function mapVaultStatus(status: OptionsVaultPanel['status']): OptionsVault['status'] {
  if (status === 'hot') return 'open'
  return status
}

function vaultMultiplier(vault: OptionsVaultPanel, side?: 'yes' | 'no'): number {
  if (side === 'no') return vault.odds.noMultiplier
  if (side === 'yes') return vault.odds.yesMultiplier
  return Math.max(vault.odds.yesMultiplier, vault.odds.noMultiplier)
}

function chainRateToUsdPerMin(rate: string): number {
  return (Number(BigInt(rate)) * 60) / USDC_SCALE
}

function marketsForStream(panel: OptionsPanel, streamId?: string) {
  if (!streamId) return panel.markets
  const filtered = panel.markets.filter(m =>
    m.marketId === streamId || m.streamId === streamId)
  return filtered.length > 0 ? filtered : panel.markets
}

export function panelToVaults(panel: OptionsPanel, streamId?: string): OptionsVault[] {
  const vaults: OptionsVault[] = []

  for (const market of marketsForStream(panel, streamId)) {
    for (const vault of market.vaults) {
      vaults.push({
        vaultId: asVaultId(vault.vaultId),
        marketId: asMarketId(market.marketId),
        question: vault.question,
        type: vault.type,
        creator: vault.creator,
        status: mapVaultStatus(vault.status),
        outcome: vault.outcome,
        pools: {
          yes: BigInt(Math.round(usdcStringToNumber(vault.pools.yesUSDC))),
          no: BigInt(Math.round(usdcStringToNumber(vault.pools.noUSDC))),
        },
        timing: {
          createdAtMs: vault.timing.createdAtMs,
          expiresAtMs: vault.timing.expiresAtMs,
        },
        steward: { hot: vault.status === 'hot' },
      })
    }
  }

  return vaults
}

/**
 * Pure projection of board → per-vault display views (A7: replaces the old render-time mutation of
 * the `mockVaultViews` module global). Callers memoize this; nothing is written to a shared global.
 */
export function panelToVaultViews(
  panel: OptionsPanel,
  streamId?: string,
): Record<string, VaultView> {
  const views: Record<string, VaultView> = {}

  for (const market of marketsForStream(panel, streamId)) {
    for (const vault of market.vaults) {
      const lane = panel.nfts
        .flatMap(n => n.lanes.map(l => ({ ...l, tokenId: n.tokenId })))
        .find(l => l.vaultId === vault.vaultId)
      const side = lane?.side

      views[vault.vaultId] = {
        sharePriceYes: usdcStringToNumber(vault.pools.sharePriceYes),
        sharePriceNo: usdcStringToNumber(vault.pools.sharePriceNo),
        multiplier: vaultMultiplier(vault, side),
        odds: vault.odds,
        poolYes: usdcStringToNumber(vault.pools.yesUSDC),
        poolNo: usdcStringToNumber(vault.pools.noUSDC),
        poolTotal: usdcStringToNumber(vault.pools.totalUSDC),
        ...(vault.steward.severity !== undefined ? { severity: vault.steward.severity } : {}),
        ...(lane && side ? { fundedSide: side } : {}),
        ...(lane && side
          ? {
              userPosition: {
                side,
                streamed: chainRateToUsdPerMin(lane.rate),
                shares: shareStringToNumber(lane.sharesAccrued),
                currentValue: lane.claimableUSDC
                  ? usdcStringToNumber(lane.claimableUSDC)
                  : 0,
              },
            }
          : {}),
        ...(vault.status === 'resolved' && lane?.won !== undefined
          ? {
              userWon: lane.won,
              payout: lane.claimableUSDC ? usdcStringToNumber(lane.claimableUSDC) : 0,
            }
          : {}),
      }
    }
  }

  return views
}

/** Pick the on-chain stream pointer for a stream/market from the board (A4). */
export function panelToStream(panel: OptionsPanel, streamId?: string): StreamPointer | undefined {
  for (const market of marketsForStream(panel, streamId)) {
    if (market.stream) {
      return { status: market.stream.status, scheme: market.stream.scheme, id: market.stream.id }
    }
  }
  return undefined
}

export function panelToFlow(panel: OptionsPanel, chain: OptionsChainKind): FlowState {
  const lvst = panel.lvst
  const balance = lvstStringToNumber(lvst.balanceLVST, chain)
  const staked = lvstStringToNumber(lvst.stakedLVST, chain)
  return {
    balance,
    staked,
    pendingDividends: usdcStringToNumber(lvst.pendingDividendsUSDC),
    totalEarned: lvst.totalEarnedLVST
      ? lvstStringToNumber(lvst.totalEarnedLVST, chain)
      : balance + staked,
    apy: 14.2,
  }
}

export function panelToPositions(panel: OptionsPanel, streamId?: string): Position[] {
  const positions: Position[] = []
  const vaultById = new Map<string, OptionsVaultPanel>()

  for (const market of marketsForStream(panel, streamId)) {
    for (const vault of market.vaults) {
      vaultById.set(vault.vaultId, vault)
    }
  }

  for (const nft of panel.nfts) {
    for (const lane of nft.lanes) {
      const vault = vaultById.get(lane.vaultId)
      if (!vault) continue
      const streamRate = chainRateToUsdPerMin(lane.rate)
      const currentValue = lane.claimableUSDC ? usdcStringToNumber(lane.claimableUSDC) : 0
      const streamed = streamRate
      positions.push({
        vaultId: lane.vaultId,
        option: vault.question,
        side: lane.side,
        streamed,
        streamRate,
        shares: shareStringToNumber(lane.sharesAccrued),
        currentValue,
        // Unrealized P&L proxy: claimable value now minus what has been streamed in (per-minute rate
        // basis). Display-only; replace with options' projectSessionPnl when it's exported.
        pnl: currentValue - streamed,
        resolved: vault.status === 'resolved',
        ...(lane.won !== undefined ? { won: lane.won } : {}),
        ...(lane.claimableUSDC ? { payout: usdcStringToNumber(lane.claimableUSDC) } : {}),
        minute: Math.max(0, Math.floor((Date.now() - vault.timing.createdAtMs) / 60_000)),
      })
    }
  }

  return positions
}

export const DEFAULT_FUND_DURATION_MIN = 60

export function usdPerMinToChainRate(rateUsdPerMin: number): bigint {
  return BigInt(Math.max(1, Math.round((rateUsdPerMin * USDC_SCALE) / 60)))
}

export function fundDepositForDuration(chainRate: bigint, durationMinutes: number): bigint {
  const durationSeconds = BigInt(Math.max(1, Math.round(durationMinutes * 60)))
  return chainRate * durationSeconds
}

export function fundCommitmentUsd(rateUsdPerMin: number, durationMinutes: number): number {
  return rateUsdPerMin * durationMinutes
}

export function findTokenIdForVault(panel: OptionsPanel, vaultId: string): string | undefined {
  for (const nft of panel.nfts) {
    if (nft.lanes.some(l => l.vaultId === vaultId)) return nft.tokenId
  }
  const market = panel.markets.find(m => m.vaults.some(v => v.vaultId === vaultId))
  if (!market) return undefined
  return panel.nfts.find(n => n.marketId === market.marketId)?.tokenId
}

export function findOptionsFunction(
  functions: readonly OptionsFunctionView[],
  name: string,
  match?: (fn: OptionsFunctionView) => boolean,
): OptionsFunctionView | undefined {
  return functions.find(fn => fn.name === name && (match ? match(fn) : true))
}

export function findFundFunction(
  functions: readonly OptionsFunctionView[],
  vaultId: string,
  side: 'yes' | 'no',
): OptionsFunctionView | undefined {
  return findOptionsFunction(functions, 'fund', fn =>
    fn.target?.kind === 'vault'
    && fn.target.vaultId === vaultId
    && fn.target.side === side)
}

export function findStopFundingFunction(
  functions: readonly OptionsFunctionView[],
  vaultId: string,
): OptionsFunctionView | undefined {
  return findOptionsFunction(functions, 'stopFunding', fn =>
    fn.target?.kind === 'vault' && fn.target.vaultId === vaultId)
}

function formatElapsed(fromMs: number): string {
  const mins = Math.max(0, Math.floor((Date.now() - fromMs) / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`
}

function homepageVaultMultiplier(vault: OptionsVaultPanel): number {
  return Math.max(vault.odds.yesMultiplier, vault.odds.noMultiplier)
}

function streamElapsed(market: OptionsMarketPanel): string {
  const fromMs = market.stream?.updatedAtMs
    ?? market.timing?.createdAtMs
    ?? Date.now()
  return formatElapsed(fromMs)
}

export function panelToHomepage(panel: OptionsPanel): HomepageData {
  const streams: HomepageStreamCard[] = []
  const liveVaults: HomepageLiveVaultCard[] = []
  const lifetimeVaults: HomepageLifetimeVault[] = []

  let totalVolume = 0
  let resolvedVaults = 0
  let yesOutcomes = 0

  for (const market of panel.markets) {
    const pooled = usdcStringToNumber(market.totals.totalPooledUSDC)
    totalVolume += pooled

    const routeId = market.marketId
    const isLive = market.stream?.status === 'live'

    if (market.status === 'open' || market.status === 'locked' || isLive) {
      streams.push({
        id: routeId,
        marketId: market.marketId,
        title: market.title,
        category: market.category ?? 'Tech',
        activeVaults: market.totals.activeVaults,
        totalPooled: pooled,
        elapsed: streamElapsed(market),
        isLive,
      })
    }

    for (const vault of market.vaults) {
      if (vault.status === 'open' || vault.status === 'hot') {
        liveVaults.push({
          vaultId: vault.vaultId,
          streamId: routeId,
          streamTitle: market.title,
          option: vault.question,
          multiplier: homepageVaultMultiplier(vault),
          totalPool: usdcStringToNumber(vault.pools.totalUSDC),
          status: vault.status === 'hot' ? 'hot' : 'open',
          expiresInSec: Math.max(0, Math.floor((vault.timing.expiresAtMs - Date.now()) / 1000)),
        })
      }

      if (vault.status === 'resolved' && (vault.outcome === 'yes' || vault.outcome === 'no')) {
        resolvedVaults += 1
        if (vault.outcome === 'yes') yesOutcomes += 1
        lifetimeVaults.push({
          vaultId: vault.vaultId,
          option: vault.question,
          streamTitle: market.title,
          outcome: vault.outcome,
          totalPool: usdcStringToNumber(vault.pools.totalUSDC),
          resolvedAtMs: vault.timing.resolvedAtMs ?? vault.timing.expiresAtMs,
        })
      }
    }
  }

  lifetimeVaults.sort((a, b) => b.resolvedAtMs - a.resolvedAtMs)

  const liveStreamCount = streams.filter(s => s.isLive).length

  return {
    streams,
    liveVaults,
    lifetimeVaults,
    protocolStats: {
      totalVaults: panel.protocol?.vaultCount ?? resolvedVaults + liveVaults.length,
      totalVolume,
      activeStreams: liveStreamCount > 0 ? liveStreamCount : streams.length,
      resolvedVaults,
      yesWinRatePct: resolvedVaults > 0 ? Math.round((yesOutcomes / resolvedVaults) * 100) : null,
    },
  }
}
