import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {
  defaultHostEdgeFixture,
  readDemoEdgeEnabled,
  readInjectedFixture,
  writeDemoEdgeEnabled,
  writeInjectedFixture,
} from '#/utils/demo'
import { env } from '#/utils/env'
import { resolveCatalog } from '#/utils/host'
import type { AppFixture, HostCatalog } from '#/types/host-edge'

interface HostContextValue {
  ready: boolean
  error: string | null
  demoEdge: boolean
  setDemoEdge: (on: boolean) => void
  fixture: AppFixture
  setFixture: (data: AppFixture | null) => void
  catalog: HostCatalog | null
  reload: () => void
}

const HostContext = createContext<HostContextValue | null>(null)

export function HostProvider({ children }: { children: ReactNode }) {
  const [demoEdge, setDemoEdgeState] = useState(() => readDemoEdgeEnabled(env.demoEdgeDefault))
  const [fixture, setFixtureState] = useState<AppFixture>(
    () => readInjectedFixture() ?? defaultHostEdgeFixture,
  )
  const [catalog, setCatalog] = useState<HostCatalog | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = useCallback(() => setReloadToken(t => t + 1), [])

  const setDemoEdge = useCallback((on: boolean) => {
    writeDemoEdgeEnabled(on)
    setDemoEdgeState(on)
    setReloadToken(t => t + 1)
  }, [])

  const setFixture = useCallback((data: AppFixture | null) => {
    writeInjectedFixture(data)
    setFixtureState(data ?? defaultHostEdgeFixture)
    setReloadToken(t => t + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setError(null)

    void resolveCatalog(env.hostBaseUrl, demoEdge, fixture)
      .then(next => {
        if (!cancelled) {
          setCatalog(next)
          setReady(true)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setCatalog(demoEdge ? fixture.catalog : null)
          setReady(true)
        }
      })

    return () => { cancelled = true }
  }, [demoEdge, fixture, reloadToken])

  const value = useMemo<HostContextValue>(() => ({
    ready,
    error,
    demoEdge,
    setDemoEdge,
    fixture,
    setFixture,
    catalog,
    reload,
  }), [ready, error, demoEdge, setDemoEdge, fixture, setFixture, catalog, reload])

  return (
    <HostContext.Provider value={value}>
      {children}
    </HostContext.Provider>
  )
}

export function useHostContext(): HostContextValue {
  const ctx = useContext(HostContext)
  if (!ctx) throw new Error('useHostContext must be used within HostProvider')
  return ctx
}
