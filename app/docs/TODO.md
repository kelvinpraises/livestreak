# app — TODO

LiveStreak frontend (TanStack Start + React 19, Vite 7). Browser SPA/SSR.

---

## ⚠️ Wallet architecture — interim, must refactor

**Current (interim, stopgap):** `src/hooks/useStealthWallet.ts` instantiates
`@livestreak/wallet` (`WalletManagerEvmErc4337`) directly inside the app and
exposes it through `WalletContext`. This was the fastest path to a building app
after dropping Circle, but it is the **wrong layering** — the app should not
import the wallet SDK at all.

**Intended design:** the app's only wallet responsibilities are

1. **Seed interface** — derive the seed from the user's password
   (`secret = sha256("livestreak-stealth-v1" + password)`; testnet-only, replace
   with real auth later).
2. **Config assembly** — build the `WalletInit` / `WalletInitConfig` object using
   the Effect Schema in **`@livestreak/schema`** (`src/wallet.ts`). `config/contracts.ts`
   `walletConfig()` already returns this shape; it should be validated against the
   schema and typed from it.

The app then **passes `{ seed, WalletInit }` into the options SDK**
(`@livestreak/options`). The **options SDK owns `@livestreak/wallet`**: it
instantiates the account and builds its own `ContractWriter` for the write
transport. The app never touches `@livestreak/wallet`.

### Refactor steps (blocked on options-SDK work)

- [ ] **options SDK:** add a wallet integration that accepts `{ seed, WalletInit }`
      (or a derived account) and produces the `ContractWriter` its
      `write/transport.ts` already expects. Decide whether options imports
      `@livestreak/wallet` directly or consumes a `contractWriterFromAccount(account)`
      shim injected at the edge.
- [ ] **app:** reduce `useStealthWallet` to a seed + `WalletInit` provider; delete
      the direct `WalletManagerEvmErc4337` usage; obtain address/balance/write
      capability from the options runtime instead.
- [ ] Validate `walletConfig()` output against `@livestreak/schema` `WalletInit`.
- [ ] Remove `@livestreak/wallet` from `app/package.json` once the app no longer
      imports it.

### Notes

- The wallet edge **fails soft**: `@livestreak/wallet` is lazy-imported and every
  wallet operation warns (never hard-throws), so a wallet/bundling failure can't
  crash the app. Keep this property through the refactor.
- Bundler/paymaster come from `VITE_BUNDLER_URL` / `VITE_PAYMASTER_URL` (host
  server); AA/Safe addresses are the CREATE2 defaults in `config/contracts.ts`.

---

## Build / toolchain notes

- Pinned **Vite 7** + `@vitejs/plugin-react` 5 (not 8/6): the wallet SDK needs
  `vite-plugin-node-polyfills`, which does not work under Vite 8's rolldown
  bundler. Matches xylkstream's proven stack.
- Node polyfills are **client-only** with `protocolImports: false` so Nitro's
  server adapter keeps native `node:` builtins. See `vite.config.ts`.
- `app` is a **standalone npm install** (its own toolchain + floating
  `@tanstack/*` versions), intentionally **not** part of the root npm workspace.

---

## Cleanup done (2026-06)

- [x] Removed Circle modular wallets (`@circle-fin/modular-wallets-core`) + passkey hook.
- [x] Dropped the `/control` route and the legacy `@livestreak/control-surface`
      dependency (the only tie to `context/quary`).
- [x] Removed the `pnpm` block; standardized on npm.
- [x] `npm run build` green (client + SSR + Nitro).
