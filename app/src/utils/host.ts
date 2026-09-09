import type {
  AgentsData,
  HomepageData as HostHomepageData,
  HostCatalog,
  HostStreamDetail,
} from '@livestreak/host'
import type { Agent } from '#/types/demo'
import type { HomepageData } from '#/types/homepage'
import type { AppFixture } from '#/types/host-edge'

const CATALOG_PATH = '/catalog'

// Page-named discovery endpoints served by the host's DB read-model (agent-2). One fetch per
// page; these are the LIVE discovery source (the aggregate across ALL markets/chains), not the
// single-market options board.
const HOMEPAGE_PATH = '/homepage'
const AGENTS_PATH = '/agents'
const STREAM_PATH = '/stream'

/** Host may emit optional settled-pool legs before `@livestreak/host` schema catches up. */
type HostLiveVault = HostHomepageData['liveVaults'][number] & { settledPool?: number }
type HostStreamSummary = HostHomepageData['streams'][number] & { settledPooled?: number }

export async function fetchHostCatalog(baseUrl: string): Promise<HostCatalog> {
  const res = await fetch(`${baseUrl}${CATALOG_PATH}`)
  if (!res.ok) {
    throw new Error(`Host catalog HTTP ${res.status}`)
  }
  return (await res.json()) as HostCatalog
}

/** GET /homepage -> the whole homepage payload (catalog rail + vault rails + protocol stats). */
export async function fetchHomepage(baseUrl: string): Promise<HostHomepageData> {
  const res = await fetch(`${baseUrl}${HOMEPAGE_PATH}`)
  if (!res.ok) {
    throw new Error(`Host homepage HTTP ${res.status}`)
  }
  return (await res.json()) as HostHomepageData
}

/** GET /agents -> the agents directory. */
export async function fetchAgents(baseUrl: string): Promise<AgentsData> {
  const res = await fetch(`${baseUrl}${AGENTS_PATH}`)
  if (!res.ok) {
    throw new Error(`Host agents HTTP ${res.status}`)
  }
  return (await res.json()) as AgentsData
}

export async function fetchHostStream(
  baseUrl: string,
  routeId: string,
): Promise<HostStreamDetail> {
  const res = await fetch(`${baseUrl}${STREAM_PATH}/${encodeURIComponent(routeId)}`)
  if (!res.ok) {
    throw new Error(`Host stream HTTP ${res.status}`)
  }
  return (await res.json()) as HostStreamDetail
}

/**
 * Project the host's discovery payload (raw `@livestreak/host` shapes) onto the app's homepage
 * CARD shapes. Shared by the LIVE host fetch (use-homepage-data) and the DEMO fixture
 * (parse-fixture) so both render identically — pure source swap. `resolvedVaults` /
 * `yesWinRatePct` are derived from the lifetime rail (the host stats payload omits them).
 */
export function hostHomepageToCards(d: HostHomepageData): HomepageData {
  const resolved = d.lifetimeVaults.length
  const yesWins = d.lifetimeVaults.filter(v => v.outcome === 'yes').length
  return {
    streams: d.streams.map(s => {
      const stream = s as HostStreamSummary
      return {
        id: stream.routeId,
        marketId: stream.marketId,
        title: stream.title,
        category: stream.category,
        activeVaults: stream.activeVaults ?? 0,
        totalPooled: stream.totalPooled ?? 0,
        ...(stream.settledPooled !== undefined ? { settledPooled: stream.settledPooled } : {}),
        elapsed: stream.elapsed ?? '',
        isLive: stream.isLive,
        ...(stream.chain ? { chain: stream.chain } : {}),
      }
    }),
    liveVaults: d.liveVaults.map(v => {
      const vault = v as HostLiveVault
      return {
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
      }
    }),
    lifetimeVaults: d.lifetimeVaults.map(v => ({
      vaultId: v.id,
      option: v.option,
      streamTitle: v.streamTitle,
      outcome: v.outcome,
      totalPool: v.totalPool,
      resolvedAtMs: Date.now() - v.resolvedAgoMs,
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

/** Resolve catalog: demo fixture or live host. */
export async function resolveCatalog(
  baseUrl: string,
  demo: boolean,
  fixture: AppFixture,
): Promise<HostCatalog> {
  if (demo) return fixture.catalog
  return fetchHostCatalog(baseUrl)
}

/** Resolve stream header + watch URL: demo fixture or live host. */
export async function resolveStream(
  baseUrl: string,
  routeId: string,
  demo: boolean,
  fixture: AppFixture,
): Promise<HostStreamDetail> {
  if (demo) {
    const hit = fixture.streams[routeId] ?? fixture.catalog.streams.find(s => s.routeId === routeId)
    if (hit) {
      return 'watchUrl' in hit
        ? hit as HostStreamDetail
        : {
            routeId: hit.routeId,
            marketId: hit.marketId,
            title: hit.title,
            category: hit.category,
            isLive: hit.isLive,
            chain: hit.chain,
          }
    }
    const first = fixture.catalog.streams[0]
    if (!first) throw new Error('Demo fixture has no streams')
    return fixture.streams[first.routeId] ?? {
      routeId: first.routeId,
      marketId: first.marketId,
      title: first.title,
      category: first.category,
      isLive: first.isLive,
      chain: first.chain,
    }
  }
  return fetchHostStream(baseUrl, routeId)
}
