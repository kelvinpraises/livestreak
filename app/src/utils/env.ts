/** Client env — single place for Vite `import.meta.env` reads. */

export const env = {
  hostBaseUrl:
    (import.meta.env.VITE_HOST_BASE_URL as string | undefined) ?? 'http://127.0.0.1:8787',
  optionsOn: (import.meta.env.VITE_OPTIONS_MODE as string | undefined) !== 'off',
  demoEdgeDefault: (import.meta.env.VITE_DEMO_EDGE as string | undefined) !== 'off',
  marketId: (() => {
    const id = import.meta.env.VITE_OPTIONS_MARKET_ID as string | undefined
    return id?.trim() || undefined
  })(),
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

export const HOST_BASE_URL = env.hostBaseUrl
export const LOCAL_CHAIN_ID = env.localChainId

export function isOptionsModeEnabled(): boolean {
  return env.optionsOn
}

export function defaultOptionsMarketId(): string | undefined {
  return env.marketId
}

/** Test-only deterministic seed (password) injected via `VITE_OPTIONS_SEED`; undefined in normal builds. */
export function testOptionsSeed(): string | undefined {
  return env.optionsSeed
}
