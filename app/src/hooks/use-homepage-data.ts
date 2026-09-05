import { useMemo } from 'react'

import { panelToHomepage } from '#/utils/options'
import type { HomepageData } from '#/types/homepage'
import {
  mockStreams,
  mockLiveVaults,
  mockLifetimeVaults,
  mockProtocolStats,
} from '#/utils/mock'
import { isOptionsModeEnabled } from '#/utils/env'
import { useOptionsContext } from '#/providers/options-provider'

function mockHomepageData(): HomepageData {
  const resolved = mockLifetimeVaults.length
  const yesWins = mockLifetimeVaults.filter(v => v.outcome === 'yes').length

  return {
    streams: mockStreams.map(s => ({
      id: s.id,
      marketId: s.id,
      title: s.title,
      category: s.category,
      activeVaults: s.activeVaults,
      totalPooled: s.totalPooled,
      elapsed: s.elapsed,
      isLive: s.isLive,
    })),
    liveVaults: mockLiveVaults.map(v => ({
      vaultId: v.id,
      streamId: v.streamId,
      streamTitle: v.streamTitle,
      option: v.option,
      multiplier: v.multiplier,
      totalPool: v.totalPool,
      status: v.status,
      expiresInSec: v.expiresIn,
    })),
    lifetimeVaults: mockLifetimeVaults.map(v => ({
      vaultId: v.id,
      option: v.option,
      streamTitle: v.streamTitle,
      outcome: v.outcome,
      totalPool: v.totalPool,
      resolvedAtMs: v.resolvedAt,
    })),
    protocolStats: {
      totalVaults: mockProtocolStats.totalVaults,
      totalVolume: mockProtocolStats.totalVolume,
      activeStreams: mockProtocolStats.activeStreams,
      resolvedVaults: resolved,
      yesWinRatePct: resolved > 0 ? Math.round((yesWins / resolved) * 100) : null,
    },
  }
}

export function useHomepageData(): HomepageData {
  const optionsEnabled = isOptionsModeEnabled()
  const { board, isConnected } = useOptionsContext()

  return useMemo(() => {
    if (optionsEnabled && isConnected && board) {
      return panelToHomepage(board.panel)
    }
    if (optionsEnabled) {
      return {
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
    }
    return mockHomepageData()
  }, [optionsEnabled, isConnected, board])
}
