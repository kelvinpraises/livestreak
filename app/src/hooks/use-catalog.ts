import { useHostContext } from '#/providers/host-provider'

/** Read-only hook — catalog comes from HostProvider (controller + demo/live). */
export function useCatalog() {
  const { catalog, ready, error, demoEdge } = useHostContext()
  return { streams: catalog?.streams ?? [], ready, error, demoEdge }
}
