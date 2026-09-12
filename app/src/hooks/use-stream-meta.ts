import { useMemo } from 'react'

import { usdcStringToNumber } from '#/utils/options'
import type { StreamMeta } from '#/types/demo'
import { useOptionsContext } from '#/providers/options-provider'
import { usePreferFixture, useParsedFixture } from '#/hooks/use-fixture-mode'

/** Honest placeholder header for a live stream that isn't on the board (yet) — never the fixture (A). */
function emptyStreamMeta(routeId: string): StreamMeta {
  return {
    id: routeId,
    title: routeId,
    category: 'Tech',
    activeVaults: 0,
    totalPooled: 0,
    elapsed: '',
    isLive: false,
  }
}

export function useStreamMeta(routeId: string): StreamMeta {
  const preferFixture = usePreferFixture()
  const parsed = useParsedFixture()
  const { board } = useOptionsContext()

  return useMemo(() => {
    if (!preferFixture) {
      // Live mode: resolve THIS stream from the board; otherwise an honest placeholder. No fixture.
      const market = board?.panel.markets.find(m =>
        m.marketId === routeId || m.streamId === routeId)
      if (market) {
        return {
          id: market.marketId,
          title: market.title,
          category: market.category ?? 'Tech',
          activeVaults: market.totals.activeVaults,
          // livePooledUSDC = the board-replayed pool (pool + sideRate × Δt at poll time) — it grows as
          // funders stream in. totalPooledUSDC is the settled snapshot and only moves on an on-chain
          // advance, so the header looked frozen. livePooledRatePerSecUSDC is the SDK's real growth
          // rate (the on-chain sideRate); ScoreUSD projects the pool forward with it between the 3s polls.
          totalPooled: usdcStringToNumber(market.totals.livePooledUSDC),
          totalPooledRatePerSec: usdcStringToNumber(market.totals.livePooledRatePerSecUSDC),
          elapsed: '',
          isLive: market.stream?.status === 'live',
        }
      }
      return emptyStreamMeta(routeId)
    }

    return parsed.streams.find(s => s.id === routeId) ?? parsed.streams[0]!
  }, [preferFixture, board, parsed, routeId])
}
