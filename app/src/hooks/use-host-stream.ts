import { useEffect, useState } from 'react'

import { env } from '#/utils/env'
import { resolveStream } from '#/utils/host'
import type { OptionsChainKind } from '#/utils/chain'
import type { HostStreamDetail } from '#/types/host-edge'

/** Per-route stream detail from host edge (or demo fixture). */
export function useHostStream(routeId: string, chain?: OptionsChainKind): {
  stream: HostStreamDetail | null
  ready: boolean
  error: string | null
} {
  const [stream, setStream] = useState<HostStreamDetail | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setStream(null)
    setReady(false)
    setError(null)

    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        const next = await resolveStream(env.hostBaseUrl, routeId, chain)
        if (!cancelled) {
          setStream(next)
          setError(null)
          setReady(true)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setReady(true)
        }
      } finally {
        // Public viewers also need lifecycle updates without a connected Options wallet.
        // Schedule after settlement: no overlapping requests or loading flicker on refresh.
        if (!cancelled) refreshTimer = setTimeout(() => { void refresh() }, 3000)
      }
    }
    void refresh()

    return () => {
      cancelled = true
      if (refreshTimer !== undefined) clearTimeout(refreshTimer)
    }
  }, [routeId, chain])

  return { stream: error && stream ? { ...stream, stale: true, isLive: false } : stream, ready, error }
}
