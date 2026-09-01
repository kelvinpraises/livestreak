import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { resolve } from 'node:path'

// @livestreak/wallet (vendored wdk-4337) is a Node/bare-runtime SDK. The browser
// build needs node polyfills; the Nitro server build runs in real Node and must
// keep native builtins. We therefore scope all polyfills to the client only.
const walletExternals = [
  '@livestreak/wallet',
  '@tetherto/wdk-wallet',
  '@tetherto/wdk-wallet-evm',
  '@safe-global/protocol-kit',
  '@safe-global/relay-kit',
  'sodium-javascript',
  'bare-node-runtime',
]

// vite-plugin-node-polyfills rewrites `buffer`/`process`/`global` imports to its
// own shim specifiers. The wallet (and its @safe-global deps) resolve from the
// repo-root node_modules, outside app/'s scope, so a plain resolve.alias is not
// reliably applied. This pre-resolver pins those shim specifiers to absolute
// paths in app/node_modules regardless of which package imported them.
function nodePolyfillShimResolver() {
  return {
    name: 'livestreak:node-polyfill-shim-resolver',
    enforce: 'pre' as const,
    resolveId(id: string) {
      const prefix = 'vite-plugin-node-polyfills/shims/'
      if (id.startsWith(prefix)) {
        const shim = id.slice(prefix.length)
        return resolve(__dirname, `node_modules/vite-plugin-node-polyfills/shims/${shim}/dist/index.js`)
      }
      return null
    },
  }
}

// Restrict a plugin (or plugin array) to the browser environment only.
function clientOnly(plugins: unknown) {
  const arr = (Array.isArray(plugins) ? plugins : [plugins]) as Array<Record<string, unknown>>
  return arr.map(p => ({
    ...p,
    applyToEnvironment: (env: { name?: string; consumer?: string }) =>
      env.name === 'client' || env.consumer === 'client',
  }))
}

const config = defineConfig({
  resolve: {
    alias: {
      'sodium-javascript': resolve(__dirname, 'node_modules/sodium-javascript'),
    },
  },
  optimizeDeps: {
    include: ['@livestreak/wallet'],
  },
  plugins: [
    nodePolyfillShimResolver(),
    devtools(),
    nitro({ rollupConfig: { external: [/^@sentry\//, ...walletExternals] } }),
    ...clientOnly(nodePolyfills({
      include: ['buffer', 'crypto', 'stream', 'assert', 'process', 'util', 'events'],
      globals: { Buffer: true, global: true, process: true },
      // Do NOT rewrite `node:`-prefixed imports: Nitro's server adapter (srvx)
      // imports `node:stream/promises` etc. and must keep them native. The client
      // wallet deps (@safe-global) use bare `buffer`/`stream` imports, which are
      // still polyfilled.
      protocolImports: false,
      overrides: { fs: 'empty' },
    })),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
