import { HeadContent, Scripts, createRootRoute, Outlet, Link, useRouterState } from '@tanstack/react-router'
import { MotionConfig } from 'framer-motion'
import appCss from '../styles.css?url'
import { WalletProvider } from '#/contexts/WalletContext.tsx'
import { ConnectButton } from '#/components/wallet/ConnectButton.tsx'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'LiveStreak' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap',
      },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <MotionConfig reducedMotion="user">
        <div className="noise-overlay" />
        {children}
        <Scripts />
        </MotionConfig>
      </body>
    </html>
  )
}

const navLinks = [
  { to: '/' as const, label: 'Home' },
  { to: '/agents' as const, label: 'Agents' },
]

function RootComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // Stream pages render their own nav inside StreamLayout
  const isStreamPage = pathname.startsWith('/stream/')

  if (isStreamPage) {
    return (
      <WalletProvider>
        <Outlet />
      </WalletProvider>
    )
  }

  return (
    <WalletProvider>
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
      background: 'var(--color-bg)',
      position: 'relative',
    }}>
      <div className="grid-bg" />
      {/* Global nav */}
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
              <span style={{ fontSize: 14, fontWeight: 800, color: '#000', fontFamily: 'var(--font-display)' }}>L</span>
            </div>
            <span className="display app-global-nav-brand-label" style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.02em' }}>LiveStreak</span>
            <span className="app-global-nav-alpha" style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '1px 5px' }}>ALPHA</span>
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
        <ConnectButton />
      </nav>
      {/* Page content */}
      <main style={{ flex: 1, position: 'relative', zIndex: 1 }}>
        <Outlet />
      </main>
    </div>
    </WalletProvider>
  )
}
