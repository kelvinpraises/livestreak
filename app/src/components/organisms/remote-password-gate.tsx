// The session password gate for /remote/<session>. Extracted from the legacy remote-console
// so the ConsoleShell page and the ?legacy view share one gate; the password is only ever sent
// over the HTTP join (scrypt-verified host-side), never the WSS leg.

import { useState } from 'react'
import { useRemote } from '#/providers/remote-provider'

export function RemotePasswordGate() {
  const { session, redeem, status, error } = useRemote()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await redeem(password)
    } catch {
      /* error surfaced via context */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '12vh auto', padding: 24 }}>
      <h1 className="display" style={{ fontSize: 20, color: 'rgba(255,255,255,0.9)', marginBottom: 4 }}>
        Remote Console
      </h1>
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 20, fontFamily: 'var(--font-mono)' }}>
        session: {session}
      </p>
      <form data-testid="remote-gate-form" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          data-testid="remote-password"
          type="password"
          value={password}
          placeholder="Session password"
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          style={{
            fontSize: 13,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.14)',
            background: 'rgba(255,255,255,0.04)',
            color: 'rgba(255,255,255,0.9)',
            fontFamily: 'var(--font-sans)',
          }}
        />
        <button
          data-testid="remote-unlock"
          type="submit"
          disabled={busy || status === 'redeeming' || status === 'connecting'}
          style={{
            fontSize: 13,
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid rgba(0,255,135,0.35)',
            background: 'rgba(0,255,135,0.12)',
            color: '#00ff87',
            fontWeight: 600,
            cursor: busy ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
        {error ? (
          <span style={{ fontSize: 11, color: '#ff2d78', fontFamily: 'var(--font-mono)' }}>{error}</span>
        ) : null}
      </form>
    </div>
  )
}
