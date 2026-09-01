# @livestreak/wallet — architecture

Multichain BIP-32 wallet manager (EVM ERC-4337 Safe + Sui). The package is **vendored WDK glue
behind a thin TypeScript facade** — observe/bookmaker/app consume it; it owns no edge config.

## Two layers

| Layer | Form | What it is |
| --- | --- | --- |
| Vendored | **JS + JSDoc** (untouched, verbatim upstream) | Tether's *top-level* WDK wrappers: `@tetherto/wdk-wallet-evm-erc-4337` and `@tetherto/wdk-wallet-sui`. We vendored the thin top-level packages, **not** the engine. |
| Ours | **TypeScript** | `create-wallet-manager.ts` (the switch), `chains/{evm,sui}.ts` (per-chain seams), `index.ts` (faceplate), `types.ts` (discriminated config). |

The underlying engine stays as **npm deps**, never vendored: `@tetherto/wdk-wallet` (the shared
`WalletManager`/`IWalletAccount` base), `@tetherto/wdk-wallet-evm`, `@mysten/sui`, `ethers`,
`@safe-global/*`. We own the glue (a few hundred lines); we buy the engine.

## The rack (folder layout)

```text
src/
  index.ts                  faceplate — re-export only
  create-wallet-manager.ts  the switch: chain -> chains/evm | chains/sui
  types.ts                  discriminated chain -> config types
  chains/{evm,sui}.ts       OUR seams — the SOLE importers of vendor/*
  vendor/                   untouched third-party JS — the patch panel, reached only via chains/*
    evm-erc-4337/  { errors.js, wallet-{manager,account,read-only}-evm-erc-4337.js }
    sui/           { wallet-{manager,account,read-only}-sui.js }
```

`vendor/` is imported only by `chains/*`; the facade goes through `chains/*` (barrel rule, no
cross-folder reach into vendored files). Clean DAG, no import cycles.

## One interface

Both chains' accounts `extends WalletManager` / implement **`IWalletAccount`** from
`@tetherto/wdk-wallet` (both pinned `1.0.0-beta.7`). That shared base *is* the multichain
abstraction — we expose it, we don't invent it. `test/types/iwallet-account.ts` proves at
compile time that `WalletAccountEvmErc4337` and `WalletAccountSui` both satisfy it.

```ts
createWalletManager(chain, seed, config)   // chain = the switch key
//   'evm' -> new WalletManagerEvmErc4337(seed, EvmErc4337WalletConfig)
//   'sui' -> new WalletManagerSui(seed, SuiWalletConfig)
//   else  -> throws ConfigurationError
```

## Build

`tsc -p tsconfig.build.json` compiles **only** our TS facade into `dist/` (it excludes
`src/vendor/**`); `scripts/copy-vendored.mjs` then copies `src/vendor/**` → `dist/vendor/**`
**byte-identical** (never routed through the compiler — a safety hedge for the bare-runtime
vendored modules). `package.json` `imports` maps `#chains/*` → `./dist/chains/*` etc. for runtime;
`tsconfig` `paths` maps them to `./src/*` for typecheck.

## Dedupe

One `@tetherto/wdk-wallet` (beta.7, shared by both chains). One sodium — standardised on
`sodium-universal` (the Sui glue imports `sodium_memzero` from it). One `bare-node-runtime`.

## What this package does NOT do

No edge config baked (seed/bundler/paymaster/rpc/entryPoint/chain/addresses arrive at runtime).
No domain logic (`registerMarket`, vaults, markets) — that lives in the consumer (observe). No
TS rewrite of the vendored crypto — it stays upstream JS so re-vendoring is a clean diff.
