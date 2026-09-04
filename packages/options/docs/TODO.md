# @livestreak/options — TODO

See [architecture.md](./architecture.md). Browser-safe consumer workflow — no market/vault creation,
no `Effect.run*`. **Wallet-direct** (R6): options imports `@livestreak/wallet` and connects via
`createWalletManager(walletInit.chain, seed, config)`, chain-dispatched (`chains/{evm,sui}`, mirror
observe/market/chains); view reads via a viem public client. ABIs from `@livestreak/contracts/evm/abis`.
`walletInit` + seed injected at runtime (seed never baked).

## ✅ Shipped & verified — R1–R3 + R6 + R7. `check`/`build` green, 47 src files / 127 tests.

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

> **R6 is uncommitted** (last code commit `ac7ec31` = R4; R2/R3 also committed). R5 (media) is uncommitted and deleted by R6.

## ▢ Open

- [x] **R7 — operation-boundary chains + bridge externality** — shipped.

After R7: app integration (below, not options) + phase-2 `Live` playback.

## Next (not options)

App integration — wire `app/` `/stream` mock hooks (`useVaults`/`useFlow`) to `createOptionsRuntime`
+ a viem `ContractReader`/`ContractWriter` at the app edge. Separate app-package prompt.

## Invariants (keep)

Side enum `yes=0`/`no=1`; `account` in Vault reads is the **`tokenId`**; pools from `getVaultPools`
(not `getVault`); `winningSide` only behind a `status === "resolved"` guard; **wallet-direct** via `createWalletManager(walletInit.chain, seed, config)` + `chains/{evm,sui}`
dispatch (mirror observe/market/chains); view reads via a viem public client; **no injected ports**.

## Verify

```
cd packages/options && npm run check && npm run build && npm test
```
