# MemWal memory layer — Sui testnet bring-up (proven end-to-end)

This documents a proven, end-to-end round-trip of the host **memory** layer
(`host/src/services/walrus/memory/**`) against **Sui testnet** — not just the
Walrus content store. A real memory binding is provisioned on-chain, a delegate
is granted, and the delegate writes a memory to Walrus and reads it back.

## What the layer does

`POST /memory/access` (router `host/src/api/routes/memory.ts`, mounted by
`server.ts` as the `walrus_memory` module at `/memory`) provisions a per-host
MemWal account, grants a caller-supplied Ed25519 delegate public key, and
returns the relayer URL, namespace, and account id the delegate then uses to
`remember`/`recall` directly against the hosted relayer.

Pipeline:

- `memwal-ops.ts` — `createMemWalAccountOperations()` wraps the
  `@mysten-incubation/memwal/account` `createAccount` / `addDelegateKey`
  on-chain calls (Sui testnet writes), signing with the owner key.
- `binding.ts` — `createMemoryBindingStore()` provisions one MemWal host
  account, caches market→binding, and tracks granted delegates.
- `routes.ts` — `handleMemoryAccess()` validates the request, provisions,
  grants, and returns `{ relayerUrl, namespace, accountId }`.
- `infrastructure/walrus/network.ts` — resolves network + deployment **per
  chain** from the relayer `/config` (no hardcoded package/registry on the
  request path).

## Configuration (env only — never commit keys)

The owner signer is read from env. The testnet deployer key is injected via
`LIVESTREAK_MEMORY_OWNER_KEY` (bech32 `suiprivkey1...`); `SUI_SECRET_KEY` /
keystore export feeds it in. Relevant env:

- `LIVESTREAK_WALRUS_NETWORK=testnet` — selects the Walrus/Sui network profile.
- `LIVESTREAK_MEMORY_OWNER_KEY=suiprivkey1...` — owner signer (or
  `LIVESTREAK_MEMORY_SUI_OWNER_KEY`). A seed (`LIVESTREAK_WALLET_SEED` /
  `LIVESTREAK_MEMORY_OWNER_SEED`) is an alternative; a direct key needs no seed.
- `LIVESTREAK_WALRUS_MEMORY_RELAYER_URL_OVERRIDE` /
  `LIVESTREAK_WALRUS_REGISTRY_ID_OVERRIDE` — optional overrides.

Testnet defaults resolve to the staging relayer
`https://relayer-staging.memory.walrus.xyz`, whose `/config` reports
`network=testnet`, `suiRpcUrl=https://fullnode.testnet.sui.io:443`, and the live
MemWal `packageId`.

## Bugs found and fixed (owning host files)

1. **`infrastructure/wallet/index.ts` — `resolveMemoryOwnerKey` rejected a
   directly-injected key.** It demanded `walletSeed ?? memoryOwnerSeed`
   unconditionally and threw `memory_owner_not_configured` even when
   `memorySuiOwnerPrivateKey` was set — contradicting
   `isMemoryHostConfigured` (which accepts a direct key). Fixed to short-circuit
   on a direct key and only fall through to the seed guard when no key is
   present. Regression test: `test/walrus/memory-owner-key.test.ts`.
2. **`infrastructure/wallet/sui.ts` — `resolveSuiOwnerPrivateKey` returned raw
   hex from the seed path.** MemWal's account ops require a bech32
   `suiprivkey1...`, so the seed path produced an unusable key. Fixed to encode
   via `Ed25519Keypair.fromSecretKey(...).getSecretKey()`.

## Proven round-trip (live, Sui testnet)

Driven by the gated host-path test `test/walrus/memory-e2e.test.ts`, which
exercises the host-owned ops + binding store (not the raw package):

```
MEMWAL_LIVE_E2E=1 LIVESTREAK_WALRUS_NETWORK=testnet \
LIVESTREAK_MEMORY_OWNER_KEY=suiprivkey1... \
  npm test -- memory-e2e
```

Result (2026-06-22, network `testnet`):

- MemWal host account (on-chain createAccount, Sui testnet WRITE):
  `0x72ab132b4bc9f0586fe4b92166d6013719d841e4db477ce328a1e663e4e927e8`
- Namespace: `market:e2e-1782119705882`
- Walrus blob id (remembered): `yQ8aM8LHkP79A2Jz9afhrU-YQ4i2yUeeu3WOSMg5ob0`
- Recall READ BACK top hit: `Flowstream host-path e2e marker e2e-1782119705882`

Owner address (testnet deployer): `0x668cfc490bd30cf8d4666e3ff39cc7fded31deee89d105267011d01abea94e84`.

## Verification

`npm run check`, `npm run build` (workspace), and `npm test` are green. The
offline suite stays deterministic: the two live tests (`memory-live`,
`memory-e2e`) are gated behind `MEMWAL_LIVE` / `MEMWAL_LIVE_E2E` and the owner
key, and skip without them. `83 passed | 3 skipped`.
