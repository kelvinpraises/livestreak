# @livestreak/contracts — TODO

See [architecture.md](./architecture.md). See [streamed-funding-explained.md](./streamed-funding-explained.md). See [repo TODO](../README.md).

**Role:** Solidity/Foundry (`chains/evm`) + Move (`chains/sui`) source of truth, plus generated ABI/types. No handwritten read/write/helper boundary — the kit comes from wagmi (EVM) / Sui SDK codegen (Sui).

---

## EVM — remaining

The shipped EVM surface (markets + `streamState`, NFT-lane `MarketDriver`, bonded-seed `VaultDriver`, streamed-funding `Vault`/`BondingBoard`, `StewardRegistry`, `Treasury`/LVST, deploy + e2e, `forge test` **137/0**) is the **parity spec** for Sui — see [architecture.md](./architecture.md). Still open:

- [ ] Steward challenge / finalize / penalty / veto surfaces (quorum + slashing)
- [ ] Resolution helper reads consolidated for options consumers
- [ ] Full AA stack — host owns bundler routes; contracts deploy Solidity pieces when needed
- [ ] **Hot-period exit burn — DEFERRED, not in the protocol.** App shows an "EXIT BURN %" badge during hot periods (`app/src/data/mock.ts` `exitBurn: 20`) and `options` plumbs `exitBurnBps`, but there is **no on-chain burn**: `Vault.withdraw`/`resolve` apply no hot-state penalty (exits stay open) and `StewardRegistry.HotState` carries only `{active, until, severity, reasonHash}` — no bps anywhere (EVM **or** Sui). A real hot-exit penalty is a token-economics decision (owner): it must be specced into the EVM source first (Vault penalty + `StewardRegistry` config + a read), then ported to Sui. Until then `exitBurnBps` stays unsupported (`undefined`) and the app hides the badge. (app + options notified 2026-06-20)

---

## Sui parity (next phase)

xylkstream's `contracts/sui` is a **Drips port to Move** — the same substrate `streaming/` was mined from. Reach **semantic parity** with the Solidity protocol, **idiomatic in Move** (objects / capabilities / Coins — not a literal transliteration). Per-module quarry map lands in `sui-quarry.md` (Stage 0).

**Quarry permutation (mirrors the EVM keep/drop):**

```text
streams.move             -> Streams.sol           KEEP  (cycle math, quarry verbatim)
movemate_ i128/i256      -> native int128/256      KEEP  (Move has no signed ints)
drips.move               -> DripsStreaming.sol     KEEP  (trim to register/receivable/cycle)
nft_driver.move          -> MarketDriver.sol       ADAPT (NFT position = owned object)
driver_utils / transfer  -> SharedDriverUtils.sol  KEEP  (driver plumbing)
splits.move              -> (dropped in EVM)       DROP
address_driver.move      -> (removed in EVM)       DROP
yield_manager.move       -> (no analog)            DROP / eval
```

**Sui-native divergences (do NOT force EVM parity):**

```text
AA / Paymaster    -> Sui sponsored transactions (no ERC-4337 port)
ERC721Enumerable  -> native (owned objects enumerate for free)
onlyOwner/sender  -> Capabilities + tx_context::sender
USDC / LVST       -> Coin<USDC> / Coin<LVST>
```

### Stage 0 — Scaffold + quarry permutation
- [x] `chains/sui/` package — `Move.toml`, `sources/` domain folders mirroring EVM, `tests/`
- [x] `sui-quarry.md` — per-module table (all ~10 ref modules: keep/adapt/drop + justification)
- [x] Quarry `i128` / `i256` math libs (rename clean, math verbatim, GPL header) → `sui move build` green
- [x] Confirm the Sui-native divergence list against the framework

### Stage 1 — Streaming substrate (quarry; GPL under `streaming/`)
- [x] `streams` cycle math — parity with `Streams.sol`: cycles, `amtPerSec`, `g`-index / receivable accounting
- [x] trimmed `drips` core — register / receivable / cycle (drop splits / router / give)
- [x] driver utils — `driver_utils` + `driver_transfer_utils` → `SharedDriverUtils` parity

### Stage 2 — Drivers
- [x] NFT driver (`nft_driver` → `MarketDriver`): position = owned object; ≤10 lanes, one-side-per-vault, `setLanes` hedge; `mint` / `fund` / `stop` / `stopAll` / `withdraw` / `claimLossLvst`
- [x] `VaultDriver`: permissionless bonded seed `createVault`, `harvest`, seed withdraw
- [x] holder enumeration via native object ownership (no `Enumerable` analog needed)

### Stage 3 — Product contracts (parity with Solidity)
- [x] `Protocol` — wiring object holding module refs / shared state
- [x] `MarketRegistry` writes — `registerMarket` (marketId = `hash(observer, streamId)`, non-zero), `addVault`
- [x] `MarketRegistry` streamState — `goLive` / `setEnded` / `isLocked`, `(scheme: StorageScheme, id: string 1..64)`, `endedAt`-set-once lock, creator-gated
- [x] `Vault` + `BondingBoard` + `Side` — binary YES/NO pool, streamed-funding `g`-index Board: `onFund` / `advance` / `settle` / `collect` / `harvest` / `withdraw` / `resolve`; flow guard (`caughtUp`)
- [x] `StewardRegistry` — default + per-market override, `resolveVault` → `Vault.resolve` (challenge/finalize/penalty/veto tracks the EVM open item)
- [x] `Treasury` + `LvstToken` — `Coin<LVST>`, loss-mint, skim, stake, dividends

### Stage 4 — Reads + kit
- [x] Market reads — `marketCount` / `marketIdAt` / `getMarket` / `getVaultIds` / `marketExists`
- [x] Vault reads — `getVault` / `getPosition` / `getBoard` / `pot` / `lossClaimable` / `caughtUp` / `pendingShares`
- [x] Steward reads — hot / dispute metadata
- [x] Sui TS kit — `@livestreak/contracts/sui` (`LiveStreakSuiClient`, `loadDeployment`, `deploy:sui`)
- [x] resolution helper reads — `resolution_reads::view_vault`
- [x] **Consumer-surface parity gaps (found via options Sui integration 2026-06-21) — DONE** (sui 121/0, forge 137/0, tsc clean):
  - [x] `vault::claimable<T>(registry, account, vault_id, side) -> u256` — live winnings+overage view; parity with EVM `Vault.claimable` (`Vault.sol:410`). Read-only; no clock param (only non-zero post-`collect`, when the board is final). Commit `080e3c0`.
  - [x] `market_driver::withdraw_many<T>(..., vault_ids: vector<vector<u8>>, ...)` — batch withdraw; parity with EVM `MarketDriver.withdraw(tokenId, bytes32[], to)` (`MarketDriver.sol:308`). Commit `d141493`.
  - [x] `steward_registry::hot_reason_hash(state: &HotState) -> vector<u8>` — accessor (EVM exposes `HotState.reasonHash`). Commit `9c40db1`.
- [x] **Browser-safe Sui deployment export — DONE.** `deploy:sui` now emits a typed `export const localnetDeployment: SuiDeployment` (`chains/sui/deployments/localnet.ts`, type-only import → browser-safe) via `writeDeploymentTs` in `promoteDeployment`; package `exports` subpath `./sui/deployments/localnet`; `build` copies `chains/sui/deployments` into `dist/`. `loadDeployment` stays for Node. Commit `16e6c2c`. Consumers import from `@livestreak/contracts/sui/deployments/localnet` (not the index, which still re-exports the node:fs `loadDeployment`).

### Stage 5 — Parity verification
- [ ] Move unit tests mirroring the forge suite (the 137 EVM cases → Move equivalents)
- [x] Sui e2e — localnet Demo Day + **n=130 bounded-advance** via SDK (`npm run e2e:sui`; needs `sui start`, not testnet)
- [ ] Invariants — conservation, `endedAt`-set-once, one-side-per-vault, flow-guard

**Cross-chain coherence:** `architecture.md` / `streamed-funding-explained.md` are the shared protocol law (why they live at package-level `docs/`). `chains/evm` and `chains/sui` are two implementations of it.

---

## Hardening

Run after touching this package. Full checklist: [repo TODO § Hardening loop](../README.md#hardening-loop).

```text
# EVM
cd packages/contracts && forge fmt --check && forge build && forge test -vv && npm run gen
# Sui
cd packages/contracts/chains/sui && sui move build && sui move test --build-env testnet
# Sui localnet kit (requires `sui start --with-faucet`, Sui CLI ≥1.73)
cd packages/contracts && npm run deploy:sui -- --name localnet && npm run e2e:sui
```

Also scan:

```text
find chains -type f -empty
grep -RInE 'src/read|src/write|packages-re2|Counter' . --exclude-dir=lib --exclude-dir=out --exclude-dir=cache --exclude-dir=build || true
```
