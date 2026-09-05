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

## Sui AA — done (2026-06-18)

- [x] Native **sponsored transactions** via `src/chains/sui/sponsored-transaction.ts`:
      `SuiGasStation.sponsor()` port + `executeSponsoredTransaction` + `assembleSponsoredTxBytes`.
- [x] Transparent `sendTransaction` wrapper (composition over vendored account via `patchSuiAccountSend`).
- [x] Offline design-defense vectors in `test/vectors/sui-sponsored.test.mjs` (4 attacks + manager-path oracle).
- [x] Inbox filed: schema gas-station config + host Sui sponsorship descriptor (not edited in this slice).

## Sui AA hardening — done (2026-06-17)

- [x] **Kind/sender trust check:** `assertGasStationReturnedTxMatchesKind` parses gas-station `txBytes`
      before sender signs; rejects kind/sender swap (malicious gas station vector).
- [x] **Barrel cleanup:** `createSuiAccount` in `account.ts`; vendored `WalletAccountSui` class re-exported from `#vendor`.
- [x] **Config dead code removed:** `assertSponsoredConfig` deleted; `isSponsoredSuiConfig` = `gasStation !== undefined`.
- [x] **Test realism:** moveCall PTB with stubbed `getObject` / `multiGetObjects`; `assembleSponsoredTxBytes` uses `SuiClient`.
- [x] **Docs:** trust rule + equivocation-at-edge note in `flow.md`.

## Deferred

- [ ] zkLogin / passkey signer abstraction (different seed model — separate track).
- [ ] Schema `SuiGasStationInitConfig` — blocked on schema inbox (`context/temp-convo/schema/inbox/from-wallet__sui-gasstation-config.md`).
- [ ] Host Sui sponsorship route — blocked on host inbox (`context/temp-convo/host/inbox/from-wallet__sui-sponsorship-descriptor.md`).

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
