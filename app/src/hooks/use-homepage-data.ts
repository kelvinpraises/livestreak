import { useEffect, useState } from 'react'

import { env } from '#/utils/env'
import { fetchHomepage, hostHomepageToCards } from '#/utils/host'
import type { HomepageData } from '#/types/homepage'

/** Honest empty state for live mode before Host data arrives. */
const EMPTY_HOMEPAGE: HomepageData = {
  streams: [],
  liveVaults: [],
  lifetimeVaults: [],
  protocolStats: {
    totalVaults: 0,
    totalVolume: 0,
    activeStreams: 0,
    resolvedVaults: 0,
    yesWinRatePct: null,
  },
}

/** Cross-chain discovery from the Host; never substitute sample data. */
export function useHomepageData(): HomepageData & { ready: boolean; error: string | null } {
  const [live, setLive] = useState<HomepageData>(EMPTY_HOMEPAGE)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLive(EMPTY_HOMEPAGE)

    // Discovery spans all chains, independently of the signing wallet.
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        const data = await fetchHomepage(env.hostBaseUrl)
        if (!cancelled) { setLive(hostHomepageToCards(data)); setError(null) }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) { setReady(true); timer = setTimeout(() => { void refresh() }, 5000) }
      }
    }
    refresh()

    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  return {
    ...live,
    ...(error ? {
      streams: live.streams.map(stream => ({ ...stream, stale: true, isLive: false })),
      liveVaults: live.liveVaults.map(vault => ({ ...vault, stale: true })),
      lifetimeVaults: live.lifetimeVaults.map(vault => ({ ...vault, stale: true })),
    } : {}),
    ready, error,
  }
}
