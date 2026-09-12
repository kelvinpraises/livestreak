import { useEffect, useState } from 'react'

import { env } from '#/utils/env'
import { fetchHomepage, hostHomepageToCards } from '#/utils/host'
import type { HomepageData } from '#/types/homepage'
import { usePreferFixture, useParsedFixture } from '#/hooks/use-fixture-mode'
import { useOptionsContext } from '#/providers/options-provider'

/** Honest empty state for live mode before/without host data — never the fixture (A). */
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

/**
 * Homepage discovery data.
 *  - DEMO mode  -> the bundled/injected fixture (the demo-edge toggle is the switch).
 *  - LIVE mode  -> the HOST's `GET /homepage` aggregate across ALL markets/chains (NOT the
 *                  single-market options board). While the fetch is in flight or fails we render
 *                  an honest empty state — never a silent fixture fallback.
 */
export function useHomepageData(): HomepageData {
  const preferFixture = usePreferFixture()
  const fixture = useParsedFixture()
  const { chain } = useOptionsContext()
  const [live, setLive] = useState<HomepageData>(EMPTY_HOMEPAGE)

  useEffect(() => {
    if (preferFixture) return
    let cancelled = false
    setLive(EMPTY_HOMEPAGE)

    // Scope discovery to the selected chain (the host's per-chain router); re-fetch on chain switch.
    void fetchHomepage(env.hostBaseUrl, chain)
      .then(data => { if (!cancelled) setLive(hostHomepageToCards(data)) })
      .catch(() => { if (!cancelled) setLive(EMPTY_HOMEPAGE) })

    return () => { cancelled = true }
  }, [preferFixture, chain])

  return preferFixture ? fixture.homepage : live
}
