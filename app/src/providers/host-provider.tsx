import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { env } from '#/utils/env'
import { fetchHostCatalog } from '#/utils/host'
import type { HostCatalog } from '@livestreak/host'

interface HostContextValue {
  ready: boolean
  error: string | null
  catalog: HostCatalog | null
  reload: () => void
}
const HostContext = createContext<HostContextValue | null>(null)
export function HostProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<HostCatalog | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const reload = useCallback(() => setReloadToken(t => t + 1), [])
  useEffect(() => {
    let cancelled = false
    setReady(false)
    setError(null)
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        const next = await fetchHostCatalog(env.hostBaseUrl)
        if (!cancelled) { setCatalog(next); setError(null) }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) { setReady(true); timer = setTimeout(() => { void refresh() }, 5000) }
      }
    }
    void refresh()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [reloadToken])
  const value = useMemo(() => ({ ready, error, catalog: error && catalog ? { ...catalog, streams: catalog.streams.map(s => ({ ...s, isLive: false, stale: true })) } : catalog, reload }), [ready, error, catalog, reload])
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>
}
export function useHostContext(): HostContextValue {
  const ctx = useContext(HostContext)
  if (!ctx) throw new Error('useHostContext must be used within HostProvider')
  return ctx
}
