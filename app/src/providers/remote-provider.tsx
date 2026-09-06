// Console-only context for the Remote Bridge Console (P5). Opens leg B via a
// RemoteTransport, holds {status, grant, functions[], board, error} and exposes
// `redeem` (password gate) + `callRemote` (relay an action envelope). Shape mirrors
// OptionsContextValue so the same renderer/atoms can be reused; but it gets its board
// and functions over the transport from the host, never from a local seeded bridge.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { CallActionEnvelope, CapabilityGrant, FunctionDescriptor } from '@livestreak/schema'
import {
  LocalMockTransport,
  type CallResult,
  type RemoteBoard,
  type RemoteStatus,
  type RemoteTransport,
} from '#/utils/remote-transport'
import { HostWssTransport } from '#/utils/host-wss-transport'
import { demoMockSeed } from '#/utils/remote-mock-seed'

// Default transport selection: the REAL HostWssTransport when a host origin is configured
// (`VITE_REMOTE_HOST_URL`), otherwise the in-process LocalMockTransport for dev/keynote demos.
function defaultTransport(): RemoteTransport {
  const hostUrl =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_REMOTE_HOST_URL
  if (hostUrl !== undefined && hostUrl.length > 0) {
    return new HostWssTransport({ hostBaseUrl: hostUrl })
  }
  return new LocalMockTransport(demoMockSeed)
}

export interface RemoteContextValue {
  readonly session: string
  readonly status: RemoteStatus
  readonly error?: string
  readonly grant?: CapabilityGrant
  readonly functions: readonly FunctionDescriptor[]
  readonly board: RemoteBoard
  readonly redeem: (password: string) => Promise<void>
  readonly callRemote: (envelope: CallActionEnvelope) => Promise<CallResult>
}

const RemoteContext = createContext<RemoteContextValue | undefined>(undefined)

export function useRemote(): RemoteContextValue {
  const ctx = useContext(RemoteContext)
  if (!ctx) throw new Error('useRemote must be used within <RemoteProvider>')
  return ctx
}

interface Props {
  readonly session: string
  // Injectable for tests / the real HostWssTransport; defaults to the local mock.
  readonly transport?: RemoteTransport
  readonly children: ReactNode
}

export function RemoteProvider({ session, transport, children }: Props) {
  const transportRef = useRef<RemoteTransport>(transport ?? defaultTransport())

  const [status, setStatus] = useState<RemoteStatus>(transportRef.current.status)
  const [error, setError] = useState<string | undefined>(undefined)
  const [grant, setGrant] = useState<CapabilityGrant | undefined>(undefined)
  const [functions, setFunctions] = useState<readonly FunctionDescriptor[]>([])
  const [board, setBoard] = useState<RemoteBoard>({})

  useEffect(() => {
    const t = transportRef.current
    const offStatus = t.onStatus(setStatus)
    const offFns = t.onFunctions(setFunctions)
    const offPatch = t.onPatch(setBoard)
    return () => {
      offStatus()
      offFns()
      offPatch()
      t.disconnect()
    }
  }, [])

  const redeem = useCallback(
    async (password: string) => {
      setError(undefined)
      const t = transportRef.current
      try {
        const redeemed = await t.redeem(session, password)
        setGrant(redeemed.grant)
        await t.connect(redeemed)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to redeem session')
        throw err
      }
    },
    [session]
  )

  const callRemote = useCallback(
    (envelope: CallActionEnvelope) => transportRef.current.send(envelope),
    []
  )

  const value = useMemo<RemoteContextValue>(
    () => ({ session, status, error, grant, functions, board, redeem, callRemote }),
    [session, status, error, grant, functions, board, redeem, callRemote]
  )

  return <RemoteContext.Provider value={value}>{children}</RemoteContext.Provider>
}
