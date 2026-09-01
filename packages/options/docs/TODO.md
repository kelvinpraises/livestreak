# @livestreak/options — TODO

See [architecture.md](./architecture.md). Depends on `@flowstream/contracts` generated ABIs for contract reads. See [repo TODO](../../../README.md).

**Role:** browser-safe consumer workflow. No market/vault creation. No `Effect.run*` in library `src/`.

---

## Slice 1 — model + read + panel (current)

- [x] `model/*` — market, vault, position, funding, flow account, snapshot aggregates
- [x] `read/*` — `OptionsReadTransport`, `readMarketSnapshot`, `readVaultSnapshot`, `readUserOptionsSnapshot`
- [x] `panel/*` — `OptionsPanel`, `projectOptionsPanel`
- [x] Fake transport test helper under `test/helpers/fake-transport.ts`
- [x] Pure tests: pool totals, sides, resolved claim/loss, panel projection
- [x] Bigint in model snapshots; string amounts in panel
- [x] Architecture + public export guards

**Follow-ups discovered in slice 1:**

- [ ] `model/resolved.ts` + `OptionsResolvedVaultView` split (architecture doc) — live `OptionsVaultPanel` currently carries resolved fields when status is resolved
- [ ] `model/odds.ts` bonding-curve odds — panel uses simple parimutuel pool ratios for v0
- [ ] `readProtocolSummary` only when transport implements it; empty-market `readUserOptionsSnapshot` without `marketId` returns LVST-only shell
- [x] Fake transport exposes `readProtocolSummary` only when protocol seed is present

---

## Slice 2 — real chain reads

**Unblocked:** `@flowstream/contracts` ships wagmi-generated ABIs. Options owns transport, address maps, and side decoding.

- [x] `createContractsOptionsReadTransport` under `src/read/contracts/`
- [x] Contract read result → Options model mapping (`mapping.ts`)
- [x] Fake reader tests — no live chain
- [ ] Wire viem/public `ContractReader` at app edge (runtime slice)
- [ ] `listMarkets` helper when options needs multi-market discovery without protocol summary
- [ ] Per-vault `lossFlowClaimable` aggregation into `LvstAccount` when `getUserVaultIds` exists on-chain

**Contract reads consumed:**

- `getMarket`, `getVaultIds`, `getVault`, `position(user, vault, side)`, `fundingRate`, `fundingActive`
- FLOW skeleton: `balanceOf`, `skeletonStaked`
- steward: `vaultHotState`, `disputeState`
- optional: `marketCount` + `marketIdAt` for `readProtocolSummary`

---

## Slice 3 — runtime + polling

- [x] `runtime/config.ts`, `store.ts`, `refresh.ts`, `runtime.ts`
- [x] `createOptionsRuntime` — manual refresh, in-memory store, `readPanel`, subscriptions
- [x] Opt-in `startPolling()` when `refreshIntervalMs` is set
- [x] Tests under `test/runtime/`
- [x] Runtime hardening: subscriber error notify, polling catch, `unknown` config validation, snapshot copies, contracts input validation
- [x] Vitest `pool: "threads"` to avoid fork-worker hangs in this environment
- [ ] Wire viem/public `ContractReader` at app edge
- [x] No wallet secrets stored in runtime (write transport injected at app edge)

---

## Slice 4a — writes (unblocked on-chain functions)

- [x] `write/transport.ts` — `ContractWriter`, `OptionsWriteTransport`, `createContractsOptionsWriteTransport`
- [x] `write/funding.ts` — `setFundingRate`, `stopFundingStream`
- [x] `write/flow.ts` — `claimLossFlow`, `stakeFlow` (`skeletonStake`), `unstakeFlow` (`skeletonUnstake`)
- [x] Contract writes via `{ address, abi, functionName, args }` from `@flowstream/contracts` ABIs + injected `ContractWriter`
- [x] Tests under `test/write/` with fake writer + negative paths
- [ ] Wire viem/wallet `ContractWriter` at app edge

---

## Slice 4b — writes (blocked on contracts)

Contract functions do not exist yet — do not implement until contracts add user claim/release + dividends:

- [ ] `write/claim.ts` — `claimVault`, `releaseVault` (Vault has factory-only `resolve`; no user claim/release)
- [ ] `claimFlowDividends` (no LvstToken function)
- [ ] `claimAndStakeLossFlow` (no combined function; use `claimLossFlow` + `skeletonStake` separately today)

---

## Slice 5 — bridge (later)

- [ ] `bridge/` callable edge when CLI/UI gateway needs it
- [ ] Action hints on panel (`canStreamYes`, `canClaim`, etc.) — read-only flags deferred until write slice

---

## Slice 6 — live stream-earnings ticker (consumer UX)

Show each funder, in real time, what their active stream is earning per second — the consumer
view of the contracts funding accumulator. Depends on the contracts funding module exposing
`pendingShares(user, vault, side)` (the zero-mutation projection of `rate_u · (G − gPaid_u)`).

- [ ] Read `pendingShares` + the inputs needed to extrapolate locally (`rate_u`, `gPaid_u`,
      side `G`/`sideRate`/`lastAdvance`, current price) into an `OptionsStreamAccrualView`.
- [ ] Client-side per-second tick: between RPC reads, project pending shares forward with the
      same formula the contract uses (shares = `rate_u · (G_now − gPaid_u)`, de-scaled), so the
      ticker animates each second without spamming the chain.
- [ ] Panel fields: pending shares now, $ value now, and current accrual rate (shares/sec) —
      note shares/sec falls as the side's pool (and price) grows, exactly per the bonding curve.
- [ ] Read-only, reconstructable, no durable state (same purity law as the rest of options).
- [ ] Blocked until the contracts funding-pricing slice ships `pendingShares`.

---

## Reads must cover

- [x] Markets, vaults, vault pools
- [x] User YES and NO positions (separate)
- [x] Funding rates per side
- [x] LVST balance, staked, pending dividends, loss claims
- [ ] Resolved vault list helper (`listResolvedVaults`) — deferred; single-vault resolved projection works via transport data

---

## Tests & guards

- [x] Fake transport tests for public read APIs
- [x] Contracts transport mapping tests (`test/read/contracts-transport.test.ts`)
- [x] Negative-path tests for missing market/vault/LVST account
- [x] Public export contract test
- [x] Architecture guards (Effect purity, forbidden imports, empty files)
- [x] Runtime tests (`test/runtime/runtime.test.ts`)
- [x] Write transport tests (`test/write/funding.test.ts`, `test/write/flow.test.ts`)

---

## Hardening (every slice)

Run after touching this package. Full checklist: [repo TODO § Hardening loop](../../../README.md#hardening-loop).

- [x] check / build / test for `packages/options` (`check` ~40s due to `@flowstream/contracts` ABI typecheck; use `pool: threads` for vitest)
- [x] Browser-safe import scan; no `Effect.run*` in `src/`
- [x] Negative-path test for every new public API
- [x] Update this `docs/TODO.md`

---

## Workspace hygiene

Canonical package path is `packages/options`. Root `package.json` workspaces include `packages/*` alongside legacy `packages-re/*`.

- [x] Use root workspace dependencies; do not add local Node-only runtime APIs to `src/`.
