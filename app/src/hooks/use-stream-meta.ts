import { useMemo } from 'react'

import type { StreamMeta } from '#/types/demo'
import { useOptionsContext } from '#/providers/options-provider'
import { usePreferFixture, useParsedFixture } from '#/hooks/use-fixture-mode'
import { useHostStream } from '#/hooks/use-host-stream'

/** Honest placeholder header for a live stream that isn't on the board (yet) — never the fixture (A). */
function emptyStreamMeta(routeId: string): StreamMeta {
  return {
    id: routeId,
    title: routeId,
    category: 'Live',
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
  const { stream: hostStream } = useHostStream(routeId)

  return useMemo(() => {
    if (!preferFixture) {
      // Live mode: resolve THIS stream from the board; otherwise an honest placeholder. No fixture.
      const market = board?.panel.markets.find(m =>
        m.marketId === routeId || m.streamId === routeId)
      if (market) {
        return {
          id: market.marketId,
          title: market.title,
          category: market.category ?? 'Sports',
          activeVaults: market.totals.activeVaults,
          // livePooledUSDC = the board-replayed pool (pool + sideRate × Δt at poll time) — it grows as
          // funders stream in. totalPooledUSDC is the settled snapshot and only moves on an on-chain
          // advance, so the header looked frozen. livePooledRatePerSecUSDC is the SDK's real growth
          // rate (the on-chain sideRate); ScoreUSD projects the pool forward with it between the 3s polls.
          totalPooled: market.totals.livePooledUSDC,
          totalPooledRatePerSec: market.totals.livePooledRatePerSecUSDC,
          elapsed: '',
          isLive: market.stream?.status === 'live',
        }
      }
      // Spectators can watch a registered broadcast before wallet/account loading succeeds.
      if (hostStream) return {
        id: hostStream.marketId ?? routeId,
        title: hostStream.title,
        category: hostStream.category ?? 'Live',
        activeVaults: hostStream.activeVaults ?? 0,
        totalPooled: hostStream.totalPooled ?? 0,
        elapsed: '',
        isLive: hostStream.isLive,
      }
      return emptyStreamMeta(routeId)
    }

    return parsed.streams.find(s => s.id === routeId) ?? parsed.streams[0]!
  }, [preferFixture, board, parsed, routeId, hostStream])
}
