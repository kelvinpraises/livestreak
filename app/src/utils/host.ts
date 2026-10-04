import { Schema } from "effect"
import {
  AgentsData,
  HomepageData as HostHomepageData,
  HostCatalog,
  HostStreamDetail,
} from '@livestreak/host'
import type { Agent } from '#/types/ui'
import type { HomepageData } from '#/types/homepage'
import type { OptionsChainKind } from '#/utils/chain'

async function fetchPage<A, I>(url: string, schema: Schema.Schema<A, I, never>): Promise<A> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`Host HTTP ${response.status}`)
  return Schema.decodeUnknownSync(schema)(await response.json())
}

const CATALOG_PATH = '/catalog'

// Page-named discovery endpoints served by the host's DB read-model (agent-2). One fetch per
// page; these are the LIVE discovery source (the aggregate across ALL markets/chains), not the
// single-market options board.
const HOMEPAGE_PATH = '/homepage'
const AGENTS_PATH = '/agents'
const STREAM_PATH = '/stream'

export async function fetchHostCatalog(baseUrl: string): Promise<HostCatalog> {
  return fetchPage(`${baseUrl}${CATALOG_PATH}`, HostCatalog)
}

/** GET /homepage[?chain] -> the homepage payload. Passing `chain` scopes it to that chain (the host's
 *  per-chain router); omit for the cross-chain aggregate. */
export async function fetchHomepage(
  baseUrl: string,
  chain?: OptionsChainKind,
): Promise<HostHomepageData> {
  const url = chain ? `${baseUrl}${HOMEPAGE_PATH}?chain=${chain}` : `${baseUrl}${HOMEPAGE_PATH}`
  return fetchPage(url, HostHomepageData)
}

/** GET /agents -> the agents directory. */
export async function fetchAgents(baseUrl: string): Promise<AgentsData> {
  return fetchPage(`${baseUrl}${AGENTS_PATH}`, AgentsData)
}

export async function fetchHostStream(
  baseUrl: string,
  routeId: string,
  chain?: OptionsChainKind,
): Promise<HostStreamDetail> {
  return fetchPage(`${baseUrl}${STREAM_PATH}/${encodeURIComponent(routeId)}${chain ? `?chain=${chain}` : ''}`, HostStreamDetail)
}

/**
 * Project the host's discovery payload (raw `@livestreak/host` shapes) onto the app's homepage
 * card shapes. `resolvedVaults` /
 * `yesWinRatePct` are derived from the lifetime rail (the host stats payload omits them).
 */
export function hostHomepageToCards(d: HostHomepageData): HomepageData {
  const verifiedResolutions = d.lifetimeVaults.filter(v => !v.stale)
  const resolved = verifiedResolutions.length
  const yesWins = verifiedResolutions.filter(v => v.outcome === 'yes').length
  return {
    indexing: d.indexing,
    streams: d.streams.map(stream => ({
      id: stream.routeId,
      marketId: stream.marketId,
      title: stream.title,
      category: stream.category,
      activeVaults: stream.activeVaults ?? 0,
      totalPooled: stream.totalPooled ?? 0,
      ...(stream.settledPooled !== undefined ? { settledPooled: stream.settledPooled } : {}),
      elapsed: stream.elapsed ?? '',
      isLive: stream.isLive,
      streamStatus: stream.streamStatus,
      indexedAtMs: stream.indexedAtMs,
      stale: stream.stale,
      ...(stream.chain ? { chain: stream.chain } : {}),
    })),
    liveVaults: d.liveVaults.map(vault => ({
      indexedAtMs: vault.indexedAtMs,
      stale: vault.stale,
      vaultId: vault.id,
      streamId: vault.streamId,
      streamTitle: vault.streamTitle,
      option: vault.option,
      multiplier: vault.multiplier,
      totalPool: vault.totalPool,
      ...(vault.settledPool !== undefined ? { settledPool: vault.settledPool } : {}),
      status: vault.status,
      expiresInSec: vault.expiresIn,
      ...(vault.chain ? { chain: vault.chain } : {}),
    })),
    lifetimeVaults: d.lifetimeVaults.map(v => ({
      indexedAtMs: v.indexedAtMs,
      stale: v.stale,
      vaultId: v.id,
      streamId: v.streamId,
      option: v.option,
      streamTitle: v.streamTitle,
      outcome: v.outcome,
      totalPool: v.totalPool,
      resolvedAtMs: v.resolutionTimeKnown === false ? 0 : (d.indexing?.generatedAtMs ?? Date.now()) - v.resolvedAgoMs,
      ...(v.chain ? { chain: v.chain } : {}),
    })),
    protocolStats: {
      totalVaults: d.protocolStats.totalVaults,
      totalVolume: d.protocolStats.totalVolume,
      activeStreams: d.protocolStats.activeStreams,
      resolvedVaults: resolved,
      yesWinRatePct: resolved > 0 ? Math.round((yesWins / resolved) * 100) : null,
    },
  }
}

/** Agents directory: live host fetch unwrapped to the row array. */
export async function fetchAgentRows(baseUrl: string): Promise<Agent[]> {
  const data = await fetchAgents(baseUrl)
  return [...data.agents]
}

/** Fetch this exact stream; missing routes never borrow another broadcast. */
export const resolveStream = fetchHostStream
