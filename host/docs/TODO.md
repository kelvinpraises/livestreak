# Host — TODO

See [architecture.md](./architecture.md), [flow.md](./flow.md). Two halves: `packages/host` (shared
types) + top-level `host/` (server edge). Cross-package asks live in `context/temp-convo/host/inbox/`
(incoming) and `<pkg>/inbox/from-host__*.md` (outgoing). This file is host's authoritative todo block.

---

## Module map (the redraw — current)

`host/src/` = `server, descriptor, aa, media, walrus/{network,memory,content}, discovery, runtime, tenancy`

- [x] `server` — capability registry, dispatch, JSON error envelope, module DI
- [x] `descriptor` — identity + capability advert (which modules live) + `/health`
- [x] `aa` — multi-chain bundler proxy (Alto) + ERC-7677 paymaster signer + boot-assert (`signer == on-chain verifyingSigner`)
- [x] `media` — sessions / policy / manifest-sign  (LiveKit forwarding = STUB)
- [x] `discovery` — vault similarity (index / find)
- [ ] `runtime` — TEE agent hosting (STUB)
- [ ] `tenancy` — api-key/tenant/account TYPES exist (`packages/host/src/tenancy.ts`) + 501 route;
      **ZERO enforcement** (open/dev). Intentionally exists-but-unused; turn on post-hack (host middleware
      + MemWal relayer gating, which ships env-configurable and off)

---

## Walrus substrate — memory + content under ONE network

- [x] **M1** — MemWal memory: real per-owner account provisioning + scoped `accountId` handoff (`POST /memory/access`)
- [x] **M1.5** — single network selector + relayer `/config` crosslink guard; folded `relayer-config`, deleted lazy closures
- [x] **M1.6** — `host/src/walrus/{network,memory,content}` born whole; ONE `LIVESTREAK_WALRUS_NETWORK`
      knob; memory MOVED (`host/src/memory/` deleted, no compat layer); content-store added; descriptor
      `walrus.network` once. Green: packages/host 16/16, host 48 passed (2 gated)
  - [x] live **content** testnet PUT→GET round-trip — **PROVEN** (re-run by prompter, 9s, real blobId)
  - [ ] live **memory** testnet round-trip — gated on a faucet-funded testnet Sui owner key (M-proof)
- Downstream: cli **M3** (ACTIVE, `prompts/cli.md`) reads `descriptor.walrus.network` + `/memory/access`;
  live memory round-trip needs a faucet-funded testnet Sui key

---

## Types (`packages/host`) — domain-owned, NO `packages/types`

- [x] `descriptor`, `aa`, `media/{policy,session,manifest,evidence}`, `memory` (`MemoryAccessRequest/Response`,
      `MarketMemoryBinding`, `MemoryNetwork`, `MemoryTrustModel`), `discovery`, `tenancy`, `validation` —
      verified domain-owned, `index.ts` re-export only, public-export guard green
- [x] **M1.6 landed**: `WalrusNetwork`, `PointerScheme` (`walrus-testnet|walrus-mainnet|ipfs|arweave`),
      `StorePointer {scheme,id,url}` in `packages/host/src/walrus.ts`, re-exported — host owns; observe
      imports from `@livestreak/host`; contracts maps `scheme → uint8` by convention
- Rule: every type imported from its owner package; never redefine; cross-cutting → `@livestreak/schema`,
  host protocol → `@livestreak/host`, wallet → `@livestreak/wallet`/`@livestreak/schema`

---

## Cross-package seams host filed (outgoing)

- [ ] **S1** app + contracts — AA chain/URL repoint: contracts ✅ done (`scopes.paymaster.contracts.verifyingSigner`); app URL/chain repoint ☐
- [ ] **S2** bookmaker / cli — inject `/discovery/find` client at the edge
- [ ] **S3** observe — adopt `/media/*` + `simulcast`; push publication at session start
- [x] media content-store — **LIVE** (`walrus/content`, proven on testnet); observe notified
      (`from-host__content-store-LIVE` + `__onchain-id-is-string`); contracts settled the on-chain pointer
      `(uint8 scheme, string id)` (`forge test` 137/0)

---

## Deferred (post-hack)

- Walrus **mainnet** flip (Walrus Memory track requires Walrus Mainnet); content "locked" long-epoch VOD
  (needs a Sui wallet — reuse `@livestreak/wallet/chains/sui`)
- LiveKit forward binding; TEE runtime; tenancy api-keys/quota; multi-host blob mirroring (cache-receipts)
- Production: chain-event vault indexer (replaces open `/discovery/vaults`); endpoint signing; audit logs; abuse controls

---

## Hardening (every slice)

```text
cd host && npm run check && npm run build && npm test
cd packages/host && npm run check && npm run build && npm test
```
