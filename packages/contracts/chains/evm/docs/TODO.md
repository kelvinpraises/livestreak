# @livestreak/contracts — TODO

See [architecture.md](./architecture.md). See [streamed-funding-explained.md](./streamed-funding-explained.md). See [repo TODO](../../../README.md).

**Role:** Solidity/Foundry source of truth plus wagmi-generated ABI/types. No handwritten TypeScript read/write/helper boundary in this package.

---

## Foundation Status

- [x] Foundry project under `packages/contracts`
- [x] Solidity contracts under `src/`
- [x] Foundry tests under `test/`
- [x] xylkstream-style deploy scaffold under `deploy/` + `script/`
- [x] wagmi config and generated ABI/types (`chains/evm/generated/abis.ts`)
- [x] package export points to generated ABI/types only
- [x] No handwritten `src/read`, `src/write`, `src/artifacts`, `src/deployments`, or `src/constants` TypeScript boundary

Current source tree:

```text
src/
  aa/
  bookmaker/
  market/
  token/
  vault/        (Vault + Board, BondingBoard, VaultFactory, Side)
  steward/
  streaming/    (DripsStreaming, Streams, Managed, Caller, drivers/AddressDriver)
```

---

## Active Slice — File Grouping Cleanup

- [x] Move from broad `src/protocol/` grouping to owner/domain folders
- [x] Keep Solidity `src/` Solidity-only
- [x] Keep TS limited to deploy orchestration and wagmi-generated ABI/types
- [x] Update imports, wagmi config, Foundry tests, docs
- [x] Run forge + wagmi verification

Target grouping (achieved):

```text
src/
  aa/
    AAImports.sol
  bookmaker/
    BookmakerRegistry.sol
  market/
    MarketRegistry.sol
  token/
    LvstToken.sol
  vault/
    Side.sol
    Vault.sol
    VaultFactory.sol
    BondingBoard.sol
  steward/
    StewardRegistry.sol
  streaming/
    DripsStreaming.sol, Streams.sol, Managed.sol, Caller.sol, IDrips.sol
    drivers/AddressDriver.sol, DriverTransferUtils.sol
```

---

## Locked Skeleton Decisions

- [x] Market ids: `keccak256(abi.encode(observer, streamId))` — deterministic, self-certifying, permissionless
- [x] Bookmaker gate: `BookmakerRegistry` authorization before `VaultFactory.createVault`
- [x] Funding: rate state only; `0` = stopped; YES/NO independent
- [x] LVST: skeleton only — `recordLossClaimable` / `claimLossLvst` / `skeletonStake`
- [x] ~~GPL decision: keep Drips Solidity out of product contracts~~ **REVERSED 2026-06-15:** project is open-sourced (GPL-compatible); mine xylkstream's Drips streaming + AA + deploy directly (cycle math kept verbatim under `src/streaming/`; splits/give/privacy/yield dropped). Streaming moves from accounting-only accrual to real Drips streams with on-chain USDC custody.
- [ ] Full AA stack — host owns bundler routes; contracts only deploy Solidity pieces when needed
- [x] Bonding curves — v0 independent per-side volume pricing (`BASE_PRICE`, `CURVE_K`, `getSharePrice`); now driven by the streamed-funding Board (`BondingBoard`)
- [x] ~~USDC drip accrual via `VaultFunding`/`creditPosition`~~ **SUPERSEDED:** real Drips streams + the Vault Board (`onFund`/`advance`/`settle`); `VaultFunding`/`creditPosition` removed
- [ ] Agent/bookmaker metadata — replace bare bookmaker bool when needed
- [ ] LVST production economics — after resolution slice

---

## Core Writes

- [x] `registerMarket` skeleton
- [x] `createVault(marketId, ...)` bookmaker-gated skeleton
- [x] ~~`setFundingRate`/`stopFundingStream` skeleton~~ → streamed: `AddressDriver.fund`/`stop`/`settle`/`claim` + `Vault.onFund`/`onStop`/`collect`/`claimFor`
- [x] steward `resolve` — `StewardRegistry.resolveVault` → `Vault.resolve` (gated to `Vault.resolver`)
- [ ] `claimVault` / `releaseVault` per side
- [ ] production `claimLossLvst` gated by vault resolution
- [ ] `claimAndStakeLossLvst`
- [ ] steward challenge / finalize / penalty / veto surfaces (quorum + slashing)

---

## Core Reads

- [x] Markets: `marketCount`, `marketIdAt`, `getMarket`, `getVaultIds`, `marketExists`
- [x] Vaults: `getVault`, `position(user, vault, side)`
- [x] ~~Funding: `fundingRate`/`fundingActive`~~ → streamed: `getBoard`, `getPosition`, `pendingShares`, `caughtUp`
- [x] Steward-visible: `vaultHotState`, `disputeState`
- [ ] `getUserVaultIds`
- [x] `getSharePrice`
- [x] `getVaultPools`
- [x] `pendingShares(funder, vault, side)` — live per-second share accrual; read-only Board replay for a real-time "what your stream is earning" ticker (REAL on `Vault`; see [streamed-funding-explained.md](./streamed-funding-explained.md) Path E)
- [ ] resolution reads: `claimableUSDC`, `winningSide`, `resolvedAt`
- [ ] LVST production reads: pending dividends, production loss claims

---

## Next Behavior Slices

### Slice A — Bonding Curve + Pool Credit

- [x] Port share pricing from old `Vault.sol` (v0: independent per-side volume; base `100_000`, k `10_000e6`)
- [x] Update YES/NO pool accounting (`yesPool`/`noPool`, `yesShares`/`noShares`, `creditPosition`)
- [x] Add `getSharePrice(vault, side)` and `getVaultPools(vault)`
- [x] Foundry tests for price movement, independence, monotonicity, creditor gating, hedging, reverts

Deferred to later curve-refinement slice: contrarian NO-driver, YES time-decay, certainty multiplier, exponents, per-vault params (needs vault timing + certainty input).

### Slice B — Funding Drip Accrual — SUPERSEDED by streamed funding

> Superseded 2026-06-16: the accounting-only `VaultFunding` accrual was replaced by **real Drips
> streams + the Vault Board** (see "Streamed Funding" below). `VaultFunding`/`creditPosition` removed.

- [x] Drip accrual: `rate × elapsed` credited into vault pools via `creditPosition` (accounting only)
- [x] `VaultFunding` set as vault `creditor` in deploy wiring
- [x] `accrue` poke + `accruedPending` view + `lastAccrualAt` state
- [x] Rate `0` remains stopped; settle-before-change on rate set/stop
- [x] No GPL Drips Solidity copy; no ERC20/USDC custody yet

### Streaming Primitive — Mined Drips (test coverage)

> Verified 2026-06-16: 46 forge tests pass (7 new in `test/streaming/DripsStreaming.t.sol`,
> backed by test-only `test/mocks/MockUSDC.sol`). The mined streaming core is proven before
> funding is wired onto it.

- [x] Cycle accrual: stream accrues `cycle × rate` over finished cycles (`receiveStreams` → `collect`)
- [x] Real USDC custody: `DripsStreaming` holds funded USDC; `collect`/`withdraw` transfers it OUT
- [x] `squeezeStreams` force-settles the in-progress cycle without waiting for it to finish
- [x] Stop halts further accrual; already-finished cycles stay receivable
- [x] Two senders / two receivers accrue independently
- [x] Reverts: `amtPerSec` below `MIN_AMT_PER_SEC`, balance above `MAX_TOTAL_BALANCE`

### Streamed Funding (Board on Vault) — DONE

> Verified 2026-06-16: 44 forge tests pass. Funding rebuilt as a per-(vault, side) Board on the Vault,
> funded via the vault-aware `AddressDriver`. Full doc: `streamed-funding-explained.md`.

- [x] `BondingBoard` pure library: curve `price()` + closed-form `lnWad` `segMath()`
- [x] Vault Board: `onFund`/`onStop` (driver-gated), `advance`/`settle`/`pendingShares`, per-funder depletion settle-at-boundary, bounded advance (`MAX_STEPS`)
- [x] Vault-aware `AddressDriver`: `fund`/`stop`/`claim` stream only into vaults, sync the Board atomically; user owns their account
- [x] Resolution: `Vault.collect` (drain pot from Drips) + `claimFor` (winner takes pot, loser = bounty)
- [x] Proofs: 498.75 worked example, I1 pool==delivered to the wei, fairness telescoping, independence, bounded-advance, bounty split
- [x] Deleted `StreamFunding`/`VaultFunding`; deploy rewired (`02-streaming`/`03-protocol`/`04-wire`); ABIs regenerated

### Slice C — Resolution + Claims + LVST

- [x] Winner claim / loser bounty — `Vault.collect` + `claimFor` + `AddressDriver.claim` (see Streamed Funding above)
- [x] Steward-gated resolution — `Vault.resolver` (set-once) + `StewardRegistry.resolveVault` (steward-gated); the factory can no longer resolve
- [x] Mid-cycle resolution squeeze — `AddressDriver.settle(funder)` / `stop` bank each active funder's in-flight Drips cycle into the vault-side, so a market that resolves mid-cycle isn't short a cycle
- [x] Pot from the Board + idempotent `collect` — pot = `yesPool + noPool` at `resolvedAt` (Board truth, invariant I1), independent of collect timing/order; `collect` is re-callable. Kills the collect-ordering footgun (an early/partial collect can no longer strand the winners)
- [x] Overage refund — USDC streamed past `resolvedAt` is recorded in `onStop` and refunded via `AddressDriver.reclaim` → `Vault.reclaimOverage`; `stop` squeezes the in-flight cycle so it is collectable. Books close exactly: every collected dollar is pot (to winner) or overage (back to streamer)
- [x] Deploy anvil-verified end-to-end — `npm run deploy -- --name localhost` then `npm run e2e` (EOA story: market→vault→fund→mid-cycle resolve→over-stream→stop→collect→claim→reclaim, vault drains to 0, 13/13). Fixed a CREATE2 ownership bug: `Ownable(msg.sender)` made the Nick factory the owner, so registries now take an explicit `initialOwner`
- [x] LVST production economics — `LvstToken.sol`: losers mint LVST = `lostUSD · mintRate()` on a curve over the cumulative house pot (fat early → flat floor); a 2% winner-skim off the losing pool feeds the pot (none when there's no opposing side); stakers earn the skim as USDC dividends; `claimLossLvst` / `claimAndStakeLossLvst` / `stakeLvst` / `unstakeLvst` / `claimDividends`. Vault skims at `collect` + provides `lossClaimable`. 7 tests + e2e ACT 6. See `lvst-token-economics`
- [ ] **Steward mechanism (slashing et al.)** — v0 is single-steward authority with no penalty. Later: quorum scaling with steward count, a challenge window (reuse `disputeState`), stake-weighting, snapshot the steward set at propose, and **slashing** a steward who resolves wrongly
- [ ] Refinements: steward sweep of overage forfeited by funders who never stop; Drips `duration` auto-stop to prevent overage at source for timed markets (needs a vault `closesAt`); editing/topping-up a live position (multi-vault per account)

### Slice D — Decode / Client Polish

- [ ] Keep generated ABI/types from wagmi
- [ ] Add decode helpers only if consumers truly need shared decode behavior
- [ ] No handwritten ABI arrays or read/write helper sprawl

---

## Hardening

Run after touching this package. Full checklist: [repo TODO § Hardening loop](../../../README.md#hardening-loop).

```text
cd packages/contracts
forge fmt --check
forge build
forge test -vv
npm run gen
```

Also scan:

```text
find src test script -type f -empty
find src -type f ! -name '*.sol'
find test -type f ! -name '*.sol'
grep -RInE 'src/read|src/write|manual GENERATED_ABIS|packages-re2|Counter' . --exclude-dir=lib --exclude-dir=out --exclude-dir=cache || true
```
