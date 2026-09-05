# @livestreak/options — TODO

See [architecture.md](./architecture.md). Browser-safe consumer workflow — no market/vault creation,
no `Effect.run*`. **Wallet-direct** (R6): options imports `@livestreak/wallet` and connects via
`createWalletManager(walletInit.chain, seed, config)`, chain-dispatched (`chains/{evm,sui}`, mirror
observe/market/chains); view reads via a viem public client. ABIs from `@livestreak/contracts/evm/abis`.
`walletInit` + seed injected at runtime (seed never baked).

## ✅ Shipped & verified — R1–R3 + R6–R13 + Sui chain leg. `check`/`build` green, 210 tests / 20 test files.

- **R1 — NFT-lane core** (committed `8d120aa`). Model keyed `tokenId → lanes` (one side per vault;
  multi-NFT via `tokensOfOwner`). Reads: `getVault` + `getVaultPools`, `getPosition`, steward
  hot/dispute, market index `+creator`. Writes → MarketDriver
  (`fund`/`setLanes`/`stop`/`stopAll`/`withdraw`/`claimLossLvst`/`transferFrom`/`approve`) + Treasury
  (`stakeLvst`/`unstakeLvst`/`claimDividends`).
- **R2 — read-views.** Claim previews (`claimable`/`lossClaimable`/`winningSide` [guarded]/`pot`); live
  ln() ticker (`OptionsStreamAccrualView`); panel win/loss amounts + flags; `architecture.md` rewritten.
- **R3 — aggregation.** Cross-NFT session PnL (`projectSessionPnl`; `invested` caller-supplied, never
  fabricated; Drips `streamsState[3]` = remaining balance); exhaustive `OptionsClaimsView`; runtime
  `set`/`get`/`onChange` in-memory API; stake grey-out flags + market total-pool + NFT transfer reads.

- **R6 — multi-chain + wallet-direct + observe structure.** `chains/{evm,sui}` dispatched on
  `walletInit.chain`; writes via `createWalletManager` + AA userOps (mirror observe); reads via a viem
  public client; injected ports dropped. Structure: `chains/` region, `model/math/`, `read/decode/`,
  every region `index.ts`. VOD stripped (raw `readStreamState` kept). Verified: 129 tests + structure/functional audits.
- ~~**R4 / R5 — media resolvers**~~ — superseded by R6 (gateway/URL resolution is not options' layer).

## ▢ Open

- [x] **R7** — operation-boundary chains + bridge externality — shipped.
- [x] **R8–R12** — UI reads (usdcBalance/account/severity), self-describing `functions[]` registry,
  one-lane-per-vault fund gating, share-price/`previewAccrual`, opt-in `autoAdvanceOverflow` — shipped.
- [x] **Sui chain leg** — wallet-direct reader/writer over Move `module::fn` calls (`7bb9fb9`) — shipped.

Next: app integration (below) + R13 (Position console) + phase-2 `Live` playback.

## Next (not options)

App integration — wire `app/` `/stream` hooks to `createOptionsBridge` (via `createOptionsRuntime`),
chain-dispatched (EVM + `createOptionsSuiConfig` for Sui). Wallet-direct — NO injected ContractReader/Writer.

## Invariants (keep)

Side enum `yes=0`/`no=1`; `account` in Vault reads is the **`tokenId`**; pools from `getVaultPools`
(not `getVault`); `winningSide` only behind a `status === "resolved"` guard; **wallet-direct** via `createWalletManager(walletInit.chain, seed, config)` + `chains/{evm,sui}`
dispatch (mirror observe/market/chains); view reads via a viem public client; **no injected ports**.

## Verify

```
cd packages/options && npm run check && npm run build && npm test
```

## Queued from inbox (2026-06-21)

- [x] **R13 — Position console reads** (from app `nft-balance-and-stream-media`) — shipped. `OptionsNftPanel`
  gains `balanceUSDC` + `runwayEndMs` (one `streamsState(tokenId, usdc)` read = balance + account `maxEnd`;
  Sui leaves both undefined). `OptionsMarketPanel.stream` carries the RAW on-chain pointer
  `{ status, scheme, id, updatedAtMs?, endedAtMs? }` from `readStreamState` — pointer only; the app resolves
  the document at `(scheme, id)`. Top-up already works (`setLanes(..., addDeposit)`).
  The stream-manifest DOCUMENT body schema (what the `(scheme, id)` doc contains for live vs VOD) is being
  converged by host + app + observe — see `from-options__stream-manifest-body-schema` in their inboxes.

### Done / resolved (cleared from this queue)
- ~~R11 (share-price / `previewAccrual`)~~ — shipped `d9ec674`.
- ~~R12 (opt-in `autoAdvanceOverflow`)~~ — shipped `c06b796`.
- ~~`exitBurnBps` population~~ — resolved: contracts confirmed no on-chain exit-burn exists; field stays `undefined`.
