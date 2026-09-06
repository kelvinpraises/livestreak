import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { WalletControls } from '#/components/molecules/wallet-controls.tsx'
import { DemoEdgeToggle } from '#/components/molecules/demo-edge-toggle'
import { AppProviders } from '#/providers'

const navLinks = [
  { to: '/' as const, label: 'Home' },
  { to: '/agents' as const, label: 'Agents' },
]

// Client-only application root. Lazy-loaded from __root.tsx so the chain SDKs it
// pulls in (@livestreak/options -> @mysten/sui, @livestreak/wallet -> Holepunch
// native deps) never enter the server/shell module graph — they cannot be
// evaluated in the Node ESM server build (see app is SPA, vite.config.ts).
export default function RootApp() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isStreamPage = pathname.startsWith('/stream/')
  // Remote Bridge Console (P5) is a standalone, full-screen surface — it brings its
  // own RemoteProvider + layout and needs no global nav/wallet chrome.
  const isBarePage = isStreamPage || pathname.startsWith('/remote/')

  return (
    <AppProviders>
      {isBarePage ? (
        <Outlet />
      ) : (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
          background: 'var(--color-bg)',
          position: 'relative',
        }}>
          <div className="grid-bg" />
          <nav className="app-global-nav" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            height: 56,
            borderBottom: '1px solid rgba(255,255,255,0.055)',
            background: 'rgba(7,7,15,0.95)',
            backdropFilter: 'blur(20px)',
            flexShrink: 0,
            zIndex: 30,
            position: 'sticky',
            top: 0,
          }}>
            <div className="app-global-nav-left" style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
              <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: 'linear-gradient(135deg, #00ff87, #00c8ff)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <img src="/livestreak-icon.png" alt="LiveStreak" style={{ width: 18, height: 18, objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
                </div>
                <span className="display app-global-nav-brand-label" style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.02em' }}>LiveStreak</span>
                <span className="app-global-nav-alpha" style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '1px 5px' }}>BETA</span>
              </Link>
              <div className="app-global-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {navLinks.map(link => {
                  const isActive = link.to === '/' ? pathname === '/' : pathname.startsWith(link.to)
                  return (
                    <Link
                      key={link.to}
                      to={link.to}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 6,
                        fontSize: 13,
                        fontWeight: 500,
                        color: isActive ? '#fff' : 'rgba(255,255,255,0.4)',
                        background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
                        textDecoration: 'none',
                        transition: 'background 0.15s, color 0.15s',
                        fontFamily: 'var(--font-sans)',
                      }}
                    >
                      {link.label}
                    </Link>
                  )
                })}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <DemoEdgeToggle />
              <WalletControls />
            </div>
          </nav>
          <main style={{ flex: 1, position: 'relative', zIndex: 1 }}>
            <Outlet />
          </main>
        </div>
      )}
    </AppProviders>
  )
}
