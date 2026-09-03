# @livestreak/options — TODO

See [architecture.md](./architecture.md). Browser-safe consumer workflow — no market/vault creation,
no `Effect.run*`. **Wallet-direct** (R6): options imports `@livestreak/wallet` and connects via
`createWalletManager(walletInit.chain, seed, config)`, chain-dispatched (`chains/{evm,sui}`, mirror
observe/market/chains); view reads via a viem public client. ABIs from `@livestreak/contracts/evm/abis`.
`walletInit` + seed injected at runtime (seed never baked).

## ✅ Shipped — R1–R3 core (decode / mapping / projection logic; 120 tests). R6 restructures the connection layer; R4/R5 media is superseded.

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

- ~~**R4 / R5 — media read + resolvers**~~ — **SUPERSEDED**: gateway/URL resolution is not options'
  layer (options does only contract I/O). R6 strips it; only the raw `readStreamState` read survives.

> R2–R4 are in the working tree, **uncommitted** (R1 = `8d120aa`).

## ▢ Open

- [ ] **R6 — multi-chain + wallet-direct realignment** (prompt written, awaiting run). Three corrections
  (2026-06-20): **(a) strip VOD** — gateway/URL resolution (R4/R5) is media plumbing, not contract I/O;
  keep only the raw `readStreamState`. **(b) wallet-direct** — drop the injected `ContractWriter` /
  `ContractReader`; connect via `createWalletManager(walletInit.chain, seed, config)` + AA userOps,
  **mirroring `observe/src/market/chains`**. **(c) multi-chain** — restructure into `chains/{evm,sui}` +
  `chains/index.ts` dispatched on `walletInit.chain` (Sui stubbed; reads via a viem public client).
  **(d) restructure to the observe aesthetic** — `chains/` region, sub-grouped `model/` (+ `model/math/`),
  thin roots, consistent `index`/`types` per region, kill the cross-layer `media` split. R1–R5 logic
  **moves**, not rewritten. Prompt is hardened (grounding preamble + structure audits).

After R6: app integration (below, not options) + phase-2 `Live` playback.

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
