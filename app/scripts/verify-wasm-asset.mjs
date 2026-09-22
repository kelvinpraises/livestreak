// B1 bundler-seam proof (browser/build path): asserts that a `vite build` of an
// entry importing the @livestreak/contracts solana barrel EMITS the engine .wasm as
// a build asset with nonzero size. This is the production-build counterpart to the
// node-path decode test (test/solana-engine-wasm.test.ts).
//
// Why a standalone minimal build (not the full app config): the seam being proved is
// vite's default handling of `new URL("./…_bg.wasm", import.meta.url)` inside
// engine-wasm.ts — it must fingerprint + emit the .wasm and rewrite the URL. That is
// vite-default rollup behavior, independent of the app's nitro/tanstack SSR plugins,
// so a minimal deterministic build isolates the thing under test and stays cheap.
// The full `npm run build` is exercised separately by CI; once A1 wires the barrel
// into a real route, the same asset lands in app/dist.
import { build } from 'vite'
import { mkdtempSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// Resolve the barrel the same way app/ does (node resolution follows the workspace
// symlink), so the probe proves the real installed artifact.
const barrelPath = createRequire(import.meta.url).resolve('@livestreak/contracts/solana')

const work = mkdtempSync(join(tmpdir(), 'b1-wasm-probe-'))
const entry = join(work, 'entry.mjs')
const outDir = join(work, 'dist')

// Touch a value from the barrel so rollup cannot tree-shake the wasm-loading module.
writeFileSync(
  entry,
  [
    "import { decodeProtocolBlob } from '@livestreak/contracts/solana'",
    'globalThis.__probe = typeof decodeProtocolBlob',
    "console.log('probe entry:', globalThis.__probe)",
  ].join('\n'),
)

let assets = []
try {
  await build({
    root: work,
    logLevel: 'warn',
    configFile: false,
    resolve: {
      // The probe root is a temp dir outside the workspace, so vite's resolver can't
      // walk up to the workspace node_modules. Pin the specifier to the barrel that
      // Node's resolver already found from the app dir (barrelPath) — app/ has no local
      // node_modules/@livestreak/contracts; resolution goes through the repo-root
      // symlink, so a hardcoded app-relative path would miss. Use the resolved artifact.
      alias: {
        '@livestreak/contracts/solana': barrelPath,
      },
    },
    build: {
      outDir,
      emptyOutDir: true,
      target: 'esnext',
      rollupOptions: { input: entry, output: { format: 'es' } },
    },
  })

  const assetsDir = join(outDir, 'assets')
  assets = readdirSync(assetsDir)
    .filter((f) => f.endsWith('.wasm'))
    .map((f) => ({ name: f, size: statSync(join(assetsDir, f)).size }))
} finally {
  rmSync(work, { recursive: true, force: true })
}

const emitted = assets.find((a) => a.size > 0)
if (!emitted) {
  console.error('FAIL: no nonzero .wasm asset emitted from the solana barrel build')
  console.error('  .wasm assets found:', JSON.stringify(assets))
  process.exit(1)
}
console.log(`PASS: engine wasm emitted as build asset -> ${emitted.name} (${emitted.size} bytes)`)
