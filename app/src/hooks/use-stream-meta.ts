import { useMemo } from 'react'

import type { StreamMeta } from '#/types/ui'
import type { HostStreamDetail } from '#/types/host-edge'

/** Honest placeholder header for a live stream that isn't on the board (yet). */
function emptyStreamMeta(routeId: string): StreamMeta {
  return {
    id: routeId,
    title: routeId,
    category: 'Uncategorized',
    activeVaults: 0,
    totalPooled: 0,
    elapsed: '',
    isLive: false,
  }
}

export function useStreamMeta(routeId: string, stream: HostStreamDetail | null): StreamMeta {
  return useMemo(() => stream ? {
    id: stream.marketId,
    title: stream.title,
    category: stream.category,
    activeVaults: stream.activeVaults ?? 0,
    totalPooled: stream.totalPooled ?? 0,
    elapsed: '',
    isLive: stream.isLive,
  } : emptyStreamMeta(routeId), [routeId, stream])
}
