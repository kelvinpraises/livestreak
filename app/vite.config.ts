import { defineConfig, type PluginOption } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'node:path'
import { createRequire } from 'node:module'

// Resolve packages from wherever npm places them — the repo-root node_modules
// (workspace hoist) or app/node_modules (Docker --install-links).
const nodeRequire = createRequire(import.meta.url)

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
// reliably applied. This pre-resolver pins those shim specifiers to the plugin's
// real install dir, resolved via Node so it works whether the plugin is hoisted
// to the repo-root node_modules or copied into app/node_modules.
function nodePolyfillShimResolver() {
  const pluginDir = path.resolve(path.dirname(nodeRequire.resolve('vite-plugin-node-polyfills')), '..')
  return {
    name: 'livestreak:node-polyfill-shim-resolver',
    enforce: 'pre' as const,
    resolveId(id: string) {
      const prefix = 'vite-plugin-node-polyfills/shims/'
      if (id.startsWith(prefix)) {
        const shim = id.slice(prefix.length)
        return path.join(pluginDir, 'shims', shim, 'dist/index.js')
      }
    },
  }
}

// vite-plugin-node-polyfills injects its browser-builtin alias map (util -> npm
// util, stream -> stream-browserify, buffer/process/global -> shims, ...) through
// a GLOBAL config() hook. `applyToEnvironment` gates a plugin's per-environment
// hooks (resolveId/transform), but it does NOT gate a global config() hook, so
// that alias map otherwise leaks into the Nitro *server* build — where it 500s
// every SSR route: react-dom's renderer calls `new util.TextEncoder()` (the npm
// util shim has no TextEncoder), and the browser CJS polyfills' circular
// require()s (fine under Node-CJS lazy semantics) hit ESM temporal-dead-zone
// errors once Nitro bundles them.
//
// Verified asymmetry: Nitro re-derives module resolution from the GLOBAL config
// and ignores per-environment alias; the client honors per-environment alias. So
// this wrapper does two things: (1) gates the polyfill's per-env hooks to the
// client, and (2) re-scopes the global config() alias into `environments.client`
// only. The browser keeps its polyfills; the server resolves bare util/stream/
// events/buffer/crypto/assert/process to native Node builtins (Node has them all,
// including TextEncoder, with no CJS->ESM cycles).
// Subset of vite-plugin-node-polyfills' config() return that we re-scope.
type PolyfillConfigResult = {
  resolve?: { alias?: Record<string, unknown> }
  environments?: Record<string, { resolve?: { alias?: Record<string, unknown> } }>
}
type ConfigHook = (config: unknown, environment: unknown) => PolyfillConfigResult | undefined

function clientScopedPolyfills(options: Parameters<typeof nodePolyfills>[0]): PluginOption[] {
  const plugins = nodePolyfills(options) as unknown as Array<Record<string, unknown>>
  return plugins.map(p => {
    const gated: Record<string, unknown> = {
      ...p,
      applyToEnvironment: (environment: { name?: string; consumer?: string }) =>
        environment.name === 'client' || environment.consumer === 'client',
    }
    // Only the polyfill's main plugin has a config() hook. It re-derives nothing
    // from `this` under Vite/rollup (it only reads this.meta.rolldownVersion, which
    // is undefined here), so a plain call is safe and lets us use an arrow function.
    if (typeof p.config === 'function') {
      const runConfig = p.config as unknown as ConfigHook
      gated.config = (config: unknown, environment: unknown) => {
        const result = runConfig(config, environment) ?? {}
        const resolveConfig = result.resolve
        const alias = resolveConfig?.alias
        if (resolveConfig && alias) {
          delete resolveConfig.alias
          result.environments ??= {}
          result.environments.client ??= {}
          result.environments.client.resolve ??= {}
          result.environments.client.resolve.alias = alias
        }
        return result
      }
    }
    return gated
  }) as unknown as PluginOption[]
}

const config = defineConfig({
  resolve: {
    alias: {
      'sodium-javascript': path.dirname(nodeRequire.resolve('sodium-javascript')),
    },
  },
  optimizeDeps: {
    include: ['@livestreak/wallet'],
  },
  plugins: [
    nodePolyfillShimResolver(),
    devtools(),
    nitro({ rollupConfig: { external: [/^@sentry\//, ...walletExternals] } }),
    ...clientScopedPolyfills({
      include: ['buffer', 'crypto', 'stream', 'assert', 'process', 'util', 'events'],
      globals: { Buffer: true, global: true, process: true },
      // Do NOT rewrite `node:`-prefixed imports: Nitro's server adapter (srvx)
      // imports `node:stream/promises` etc. and must keep them native. The client
      // wallet deps (@safe-global) use bare `buffer`/`stream` imports, which are
      // polyfilled in the browser bundle only (see clientScopedPolyfills).
      protocolImports: false,
      overrides: { fs: 'empty' },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
