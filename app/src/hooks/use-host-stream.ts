import { useEffect, useState } from 'react'

import { env } from '#/utils/env'
import { useHostContext } from '#/providers/host-provider'
import { resolveStream } from '#/utils/host'
import type { HostStreamDetail } from '#/types/host-edge'

/** Per-route stream detail from host edge (or demo fixture). */
export function useHostStream(routeId: string): {
  stream: HostStreamDetail | null
  ready: boolean
  error: string | null
} {
  const { demoEdge, fixture } = useHostContext()
  const [stream, setStream] = useState<HostStreamDetail | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setError(null)

    void resolveStream(env.hostBaseUrl, routeId, demoEdge, fixture)
      .then(next => {
        if (!cancelled) {
          setStream(next)
          setReady(true)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setStream(null)
          setReady(true)
        }
      })

    return () => { cancelled = true }
  }, [routeId, demoEdge, fixture])

  return { stream, ready, error }
}
