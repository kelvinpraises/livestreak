/** Client env — single place for Vite `import.meta.env` reads. */

export const env = {
  hostBaseUrl:
    (import.meta.env.VITE_HOST_BASE_URL as string | undefined) ?? 'http://127.0.0.1:8787',
  optionsOn: (import.meta.env.VITE_OPTIONS_MODE as string | undefined) !== 'off',
  demoEdgeDefault: (import.meta.env.VITE_DEMO_EDGE as string | undefined) !== 'off',
  // Test-only deterministic wallet seed. When `VITE_OPTIONS_SEED` is set (e.g. "1234"),
  // connect() derives the operator secret from this value instead of the typed password,
  // yielding a REPRODUCIBLE Safe (EVM) + Sui address for E2E/CDP runs. Unset in normal
  // builds → undefined → no behavior change. Not a secret: testnet convenience only.
  optionsSeed: (() => {
    const seed = import.meta.env.VITE_OPTIONS_SEED as string | undefined
    return seed?.trim() || undefined
  })(),
  localChainId: 31337,
} as const

// import.meta.env.DEV is a Vite BUILD-TIME boolean (not runtime config), so it is read directly at
// its use sites (e.g. use-wallet-actions.ts) rather than routed through this module.

export const HOST_BASE_URL = env.hostBaseUrl
export const LOCAL_CHAIN_ID = env.localChainId

export function isOptionsModeEnabled(): boolean {
  return env.optionsOn
}

/** Test-only deterministic seed (password) injected via `VITE_OPTIONS_SEED`; undefined in normal builds. */
export function testOptionsSeed(): string | undefined {
  return env.optionsSeed
}
