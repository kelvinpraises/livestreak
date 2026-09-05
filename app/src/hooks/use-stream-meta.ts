import { useMemo } from 'react'

import { usdcStringToNumber } from '#/utils/options'
import { mockStreams, type StreamMeta } from '#/utils/mock'
import { isOptionsModeEnabled } from '#/utils/env'
import { useOptionsContext } from '#/providers/options-provider'

export function useStreamMeta(routeId: string): StreamMeta {
  const optionsEnabled = isOptionsModeEnabled()
  const { board, isConnected } = useOptionsContext()

  return useMemo(() => {
    if (optionsEnabled && isConnected && board) {
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

    return mockStreams.find(s => s.id === routeId) ?? mockStreams[0]!
  }, [optionsEnabled, isConnected, board, routeId])
}
