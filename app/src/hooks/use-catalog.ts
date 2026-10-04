import { useHostContext } from '#/providers/host-provider'

/** Read-only hook — catalog comes from HostProvider (live discovery). */
export function useCatalog() {
  const { catalog, ready, error } = useHostContext()
  return { streams: catalog?.streams ?? [], ready, error }
}
