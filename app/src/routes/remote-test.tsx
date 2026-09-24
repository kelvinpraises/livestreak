// /remote-test — the console test bed. Renders the Desk/Focus/Attention shell against fixture
// models only: no provider, no transport, no gateway. Once the shape is approved this shell ports
// into /remote and the fixtures are replaced by the unified board fed over leg B.

import { createFileRoute } from '@tanstack/react-router'
import { ConsoleShell } from '#/components/template/console-shell'
import { consoleFixtures } from '#/utils/console-fixtures'

export const Route = createFileRoute('/remote-test')({
  component: RemoteTestPage,
})

function RemoteTestPage() {
  // body is `overflow: hidden` (app-shell) — each route owns its scroll container (cf. remote/$session).
  return (
    <div style={{ height: '100vh', overflowY: 'auto' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '16px 24px 0' }}>
        <span
          style={{
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: 'rgba(255,178,36,0.8)',
            border: '1px solid rgba(255,178,36,0.35)',
            borderRadius: 6,
            padding: '2px 8px',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          test bed · fixture data
        </span>
      </div>
      <ConsoleShell models={consoleFixtures} />
    </div>
  )
}
