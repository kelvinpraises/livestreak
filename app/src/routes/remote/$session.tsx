import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { RemoteProvider, useRemote } from '#/providers/remote-provider'
import { RemoteConsole } from '#/components/template/remote-console'

// Password-gated Remote Bridge Console at /remote/<session> (P5). Opens leg B via
// HostWssTransport against the host relay, redeems the session behind a password gate,
// then renders auto-forms from the gateway's in-scope functions[].
export const Route = createFileRoute('/remote/$session')({
  component: RemoteConsolePage,
})

function RemoteConsolePage() {
  const { session } = Route.useParams()
  return (
    <RemoteProvider session={session}>
      <RemoteSessionGate session={session} />
    </RemoteProvider>
  )
}

/** When the gateway drops, leave the console — the session is no longer usable. */
function RemoteSessionGate({ session }: { readonly session: string }) {
  const { status } = useRemote()
  const navigate = useNavigate()
  // Only a close that FOLLOWS a real connection ends the session. A pre-open teardown (React dev
  // double-mount) must not redirect home before the password screen renders.
  const hadConnected = useRef(false)
  if (status === 'open') {
    hadConnected.current = true
  }
  const ended = status === 'closed' && hadConnected.current

  useEffect(() => {
    if (ended) {
      void navigate({ to: '/', replace: true })
    }
  }, [ended, navigate])

  if (ended) {
    return (
      <div style={{ maxWidth: 420, margin: '20vh auto', padding: 24, textAlign: 'center' }}>
        <h1 className="display" style={{ fontSize: 18, color: 'rgba(255,255,255,0.85)' }}>
          Session ended
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', fontFamily: 'var(--font-mono)' }}>
          {session} — gateway disconnected
        </p>
      </div>
    )
  }

  return <RemoteConsole />
}
