import type { AppFixture, HostCatalog, HostStreamDetail } from '#/types/host-edge'

const CATALOG_PATH = '/catalog'

export async function fetchHostCatalog(baseUrl: string): Promise<HostCatalog> {
  const res = await fetch(`${baseUrl}${CATALOG_PATH}`)
  if (!res.ok) {
    throw new Error(`Host catalog HTTP ${res.status}`)
  }
  return (await res.json()) as HostCatalog
}

export async function fetchHostStream(
  baseUrl: string,
  routeId: string,
): Promise<HostStreamDetail> {
  const res = await fetch(`${baseUrl}${CATALOG_PATH}/streams/${encodeURIComponent(routeId)}`)
  if (!res.ok) {
    throw new Error(`Host stream HTTP ${res.status}`)
  }
  return (await res.json()) as HostStreamDetail
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
    }
  }
  return fetchHostStream(baseUrl, routeId)
}
