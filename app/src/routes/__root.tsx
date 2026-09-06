import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useState } from 'react'
import { MotionConfig } from 'framer-motion'
import appCss from '../styles.css?url'

// The app is a client-only SPA (ssr disabled in vite.config.ts). The real app
// tree — providers + wallet/chain SDKs — lives in RootApp and is loaded lazily
// so its server-incompatible deps (@mysten/sui, Holepunch native modules) never
// enter the prerendered shell's module graph.
const RootApp = lazy(() => import('#/components/template/root-app.tsx'))

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

function RootComponent() {
  // Client-only. The prerender/SSR pass renders just the shell (above); RootApp —
  // and with it the providers and wallet/chain SDKs (viem, ethers, @mysten/sui,
  // Holepunch) — mounts only after hydration. This keeps that whole graph out of
  // the server render, which a pure SPA never serves, and avoids prerendering the
  // node-native deps (the sodium __filename error). Server and first client render
  // both return null, so hydration matches.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return (
    <Suspense fallback={null}>
      <RootApp />
    </Suspense>
  )
}
