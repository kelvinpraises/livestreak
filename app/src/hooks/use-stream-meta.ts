import { useMemo } from 'react'

import { usdcStringToNumber } from '#/utils/options'
import type { StreamMeta } from '#/types/demo'
import { useOptionsContext } from '#/providers/options-provider'
import { usePreferFixture, useParsedFixture } from '#/hooks/use-fixture-mode'

export function useStreamMeta(routeId: string): StreamMeta {
  const preferFixture = usePreferFixture()
  const parsed = useParsedFixture()
  const { board } = useOptionsContext()

  return useMemo(() => {
    if (!preferFixture && board) {
      const market = board.panel.markets.find(m =>
        m.marketId === routeId || m.streamId === routeId)
      if (market) {
        return {
          id: market.marketId,
          title: market.title,
          category: market.category ?? 'Tech',
          activeVaults: market.totals.activeVaults,
          totalPooled: usdcStringToNumber(market.totals.totalPooledUSDC),
          elapsed: '',
          isLive: market.stream?.status === 'live',
        }
      }
    }

    return parsed.streams.find(s => s.id === routeId) ?? parsed.streams[0]!
  }, [preferFixture, board, parsed, routeId])
}
