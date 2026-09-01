# @livestreak/wallet — TODO

See [architecture.md](./architecture.md) and [flow.md](./flow.md).

## Done (verified 2026-06-18)

- [x] Multichain unification: EVM ERC-4337 + Sui quarried into one package over the shared
      `@tetherto/wdk-wallet` base (both pin `1.0.0-beta.7`).
- [x] Rack layout: vendored JS under `src/vendor/<chain>/` (untouched), TS facade in `src/` + `src/chains/`.
- [x] Unified export: `createWalletManager(chain, seed, config)` default; per-chain classes named; `ConfigurationError` on unknown chain.
- [x] Golden vectors (offline, deterministic): EVM (owner EOA, Safe address, signature) + Sui (address, Ed25519 signature) — `node:test`, **8/8 green** including the export-surface + negative-path test.
- [x] `IWalletAccount` type-satisfaction proof for both chains (`test/types/iwallet-account.ts`, checked by `npm run check`).
- [x] `check` / `build` / `lint` / `test` all green. Package importable; sodium deduped to `sodium-universal`.
- [x] Test runner fixed: was `vitest` (looking for `*.test.ts`) silently running nothing; now `node --test` runs the `.mjs` vectors with zero transform.

## Cross-package — done (2026-06-18)

- [x] **App migration:** `app/src/hooks/useStealthWallet.ts` switched from the default constructor to
      the named `WalletManagerEvmErc4337` export. App `tsc` no longer reports any wallet-related error.
- [x] **Schema Sui config:** added `SuiWalletInitConfig` (rpcUrl + retries — Sui signs natively, no
      bundler/paymaster), `WalletChain`, and folded EVM+Sui into one chain-discriminated `WalletInit` (renamed `WalletInitConfig`→`EvmWalletInitConfig`) in
      `@livestreak/schema` `wallet.ts`. Schema `check`/`build` green.
- [x] **Browser-bundle pre-check:** `app/` `vite build` exits 0 — `@livestreak/wallet`, `sodium-universal`,
      `sodium-native`, `bare-node-runtime` all resolve/externalize cleanly (client + Nitro server). No CONFLICT.

## Remaining (not wallet-owned)

- [ ] `app/vite.config.ts:117–131` has 6 pre-existing `TS2769` errors (vite plugin overloads), unrelated
      to the wallet work — separate app-infra fix.

## Maintenance loop

The golden vectors are the **oracle**. Any re-vendor of the WDK glue (diff against npm upstream) must
keep EVM + Sui vectors byte-identical, or the crypto changed. The vendored `src/vendor/**` is the diff
target — never hand-edit it; drop in the new upstream `.js` and re-run the vectors.
