import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useRef } from 'react'
import { RemoteProvider, useRemote } from '#/providers/remote-provider'
import { RemoteConsoleShell } from '#/components/template/remote-console-shell'

// Password-gated Remote Bridge Console at /remote/<session> (P5). Opens leg B via
// HostWssTransport against the host relay, redeems the session behind a password gate,
// then renders the Desk · Focus · Attention console over the gateway's in-scope functions[].
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

/** Keep the console in place during transport recovery; show terminal reasons explicitly. */
function RemoteSessionGate({ session }: { readonly session: string }) {
  const { status } = useRemote()
  const navigate = useNavigate()
  // Only a close that FOLLOWS a real connection ends the session. A pre-open teardown (React dev
  // double-mount) must not redirect home before the password screen renders.
  const hadConnected = useRef(false)
  if (status === 'open') {
    hadConnected.current = true
  }
  const ended = ['closed', 'revoked', 'expired', 'unavailable', 'error'].includes(status) && hadConnected.current

  if (ended) {
    return (
      <div style={{ maxWidth: 420, margin: '20vh auto', padding: 24, textAlign: 'center' }}>
        <h1 className="display" style={{ fontSize: 18, color: 'rgba(255,255,255,0.85)' }}>
          Session ended
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', fontFamily: 'var(--font-mono)' }}>
          {session} — {status === 'revoked' ? 'access revoked' : status === 'expired' ? 'session expired' : status === 'unavailable' ? 'connection could not be restored' : 'connection ended'}
        </p>
        <button type="button" onClick={() => { void navigate({ to: '/' }) }}>Leave console</button>
      </div>
    )
  }

  // body is `overflow: hidden` (app-shell), so each route owns its scroll container (cf. index.tsx).
  // Without this the console clips everything below the fold (board, revealed functions) with no scroll.
  return (
    <div style={{ height: '100vh', overflowY: 'auto' }}>
      {status === 'reconnecting' ? (
        <div role="status" aria-live="polite" style={{ padding: '12px 24px', background: '#211c10', color: '#ffd48a' }}>
          Reconnecting… Your console will refresh when the connection returns. Actions are paused.
          <button type="button" style={{ marginLeft: 16 }} onClick={() => { void navigate({ to: '/' }) }}>Leave</button>
        </div>
      ) : null}
      <RemoteConsoleShell />
    </div>
  )
}
