# @livestreak/contracts Architecture

This document is for the developer who arrives with no conversation history and needs to move. It explains the contract architecture we want, why the folders exist, what each downstream package may assume, and how Solidity, TypeScript artifacts, and AA execution fit together.

The short version: **`packages/contracts` is the on-chain source of truth** for LiveStreak. It owns market/vault indexing, YES/NO pools, per-side positions, funding-stream state, resolution/claims, LVST loss accounting, and steward-visible hot/dispute metadata. **wagmi-generated ABIs** (`chains/evm/generated/abis.ts`) are the TypeScript boundary — no handwritten read/write helpers in this package. **`options`**, **`bookmaker`**, and **`steward`** depend on this surface — lock contracts before implementing those packages or everyone keeps guessing what state exists and who owns each write.

## Vocabulary

Use these terms in code and docs:

| Correct term | Meaning |
| --- | --- |
| `Market` | Parent grouping/index. v0: on-chain registry entry. Later: host/indexer may mirror or replace index reads. |
| `Vault` | One binary YES/NO prediction pool inside a market. |
| `Side` | `yes` or `no`. Separate position storage and funding stream per side. |
| `Funding stream` | Continuous drip rate per `user + vault + side`. Rate `0` = stopped. Not a one-shot deposit. |
| `Position` | Shares and deposited USDC for one `(vault, side, account)`. **One active side per vault per NFT** — hedge by `setLanes` flip; prior-side shares survive on the Board. |
| `Resolution` | Winning side recorded on vault. Challenge/dispute window before finalize. |
| `Claim` / `Withdraw` | Pull USDC winnings + overage after resolution via `MarketDriver.withdraw(tokenId, vaultId, to)` (single or mass). |
| `Loss claim` | LVST minted/accounted because user lost USDC in a resolved vault. |
| `Hot state` | Steward-triggered adverse period on a vault. Contracts store state; steward owns decision workflow. |
| `Contract read surface` | Typed view/pure reads exposed by Solidity; consumers call via wagmi ABIs + injected transport |
| `Contract write surface` | Typed mutating calls exposed by Solidity; consumers encode via wagmi ABIs + injected wallet |

**Side encoding:** Solidity uses a `Side` enum (`Yes`, `No`). TypeScript decoders map to `"yes" | "no"` for options and UI. Do not use bare `bool yesSide` as the only public read API.

Do not use these as contract architecture terms:

| Old / wrong term | Replacement |
| --- | --- |
| `Vault.createVault` as consumer API | Bookmaker-facing `createVault` / factory; options does not create |
| `stream(amount)` one-shot deposit | `setFundingRate` / funding-stream state |
| Combined `getPosition(user)` only | `position(user, vault, YES)` and `position(user, vault, NO)` |
| `contracts-re` as deploy truth | Foundry deploy scripts + `packages/contracts` deployment metadata |
| Session keys in v0 | AA wallet + bundler; no session-key contract flows yet |
| Privacy/yield/circles from xylkstream | Out of scope — extract streaming + AA only |

## What Contracts Own

```text
contracts owns:
  Protocol (set-once address book)
  MarketRegistry + permissionless VaultDriver.createVault (bonded seed)
  MarketDriver NFT (≤10 lanes, one side per vault, setLanes hedge)
  Vault YES/NO Boards + bonding curve + harvest-on-cycle settlement
  StewardRegistry (default + per-market steward, resolveVault)
  Treasury / LvstToken (skim, loss-mint, stake, dividends)
  DripsStreaming rail (no squeeze in drivers)

options consumes:
  reads markets / vaults / positions / LVST
  calls fund / setLanes / withdraw / claimLossLvst / stake
  does not register markets or create vaults (observe / bookmaker edges do)

observe / observer edge owns:
  market registration (registerMarket when stream starts)

anyone may:
  VaultDriver.createVault under an existing market (bonded directional seed)
```

Contracts are the **authority** for on-chain state. TypeScript packages decode and project; they do not invent parallel state.

## Package Split

`packages/contracts` is chain-first: each chain is self-contained under `chains/<name>/`; the npm publish surface is `kit/`.

```text
packages/contracts/
  chains/
    evm/
      solidity/           Foundry source (Protocol, vault/, streaming/, steward/, …)
      test/  lib/  deploy/{scopes,output}  docs/
      generated/abis.ts   wagmi output (npm run build in chains/evm)
      foundry.toml  wagmi.config.ts
      index.ts            chain export: ABIs + addresses + types
      addresses.ts        flatten deploy/output/*.json
    sui/index.ts          stub
    solana/index.ts       stub
  kit/
    index.ts              export * as evm | sui | solana
    types.ts              cross-chain types only (ContractChain)
  dist/                   gitignored → dist/{kit,chains}
```

| Layer | Owns | Does not own |
| --- | --- | --- |
| `chains/evm/solidity/` | Market registry, vaults, funding streams, LVST, steward hooks, events | UI, polling, panel projection, bookmaker strategy |
| `chains/evm/generated/` | ABIs and contract types from forge artifacts | Business workflows, read/write orchestration |
| `kit/` | npm facade (`import { evm } from "@livestreak/contracts"`) | Solidity, deploy scripts |
| Host AA edge | UserOp submission proxy, paymaster endpoint, 4337 execution support | Vault math, market indexing, contract ABIs |

Downstream packages import **`@livestreak/contracts`** (`evm.vaultAbi`, `evm.localhostAddresses`, …). They own transport, polling, and domain mapping (e.g. `packages/options/src/read/contracts/`).

## Quarry Map (What To Reuse, What To Reject)

Do not treat any existing tree as final re2 architecture.

| Source | Role | Use | Reject |
| --- | --- | --- | --- |
| `packages/contracts` (old LiveStreak) | Domain mechanics quarry | YES+NO simultaneous positions, LVST mint on loss, staking/dividends, bonding-curve pools, hot exit burns, steward proposals | `createVault` on consumer path, global `vaultIds` without markets, one-shot `stream`, `onlyOwner triggerHot`, LVST mint only inside `withdraw`, `ProtocolLP.notifyDividends` `tx.origin` pattern |
| `contracts-re` | TS artifact packaging quarry | Hand-shaped ABI metadata pattern, deployment ordering ideas, enum maps | Trusted deploy truth (constructor metadata was wrong), stale as final ABI |
| `xylkstream` AA / WDK | Wallet execution quarry | `apps/packages/wdk-4337/`, `XylkPaymaster.sol`, deploy scopes `01-aa`, `05-paymaster`, stealth wallet provider patterns | Full privacy/circle/yield stack |
| `xylkstream` Streams / Drips | Streaming primitive quarry | `Streams.sol` cycle math (verbatim), `Managed`/`Caller`, `AddressDriver`, account id packing, setStreams/receiveStreams/squeezeStreams/collect — mined into `src/streaming/` as `DripsStreaming` | Splits fan-out, `give`, `DripsRouter` diamond, privacy facets / ZW token paths, yield |
| `xylkstream` bundler | AA infrastructure quarry | `apps/server/src/interfaces/api/routes/bundler.ts` — JSON-RPC proxy to Alto per chain; port into top-level `host/aa/` | Coupling bundler to vault contracts or `@livestreak/contracts` |

### Streaming primitive extraction (from xylkstream)

Mined into `src/streaming/` — Drips is a quarry, not a template. The goal is narrow (stream funds in, single receiver collects once), so the audited `Streams.sol` cycle math is kept **verbatim** while the Splits fan-out subsystem, `give`, privacy, and yield are left behind.

The streaming primitive is test-covered (`test/streaming/DripsStreaming.t.sol`, against a test-only `MockUSDC`): cycle accrual, `squeezeStreams` force-settle, stop-halts-accrual, independent accounts, real on-chain USDC custody (collect transfers tokens out), and the min-rate / max-balance revert paths.

```text
AA wallet execution
  Safe 4337
  EntryPoint
  Paymaster (LiveStreakPaymaster)
  WDK wrapper
  UserOp send/wait helpers
  host bundler route: POST /aa/bundler/:chain -> local Alto/provider
  host paymaster route: POST /aa/paymaster -> sponsorship/signing

Streaming primitive (src/streaming/)
  ManagedProxy -> DripsStreaming (Managed + Streams verbatim)
  AddressDriver — VAULT-AWARE user driver: fund/stop/settle/claim stream only into vault-sides
  Caller — ERC-2771 forwarder
  setStreams        fund / reduce a stream
  receiveStreams    settle finished cycles -> collectable ledger
  squeezeStreams    force-settle the in-progress cycle
  collect           single-balance collect-once, then withdraw
```

### Licensing

The mined streaming Solidity (`Streams.sol`, `Managed.sol`, `Caller.sol`, `DripsStreaming.sol`, drivers) and `VerifyingPaymaster`/`LiveStreakPaymaster` are **GPL-3.0-only**, inherited from the Drips quarry. LiveStreak is open-sourced (GPL-compatible), so the earlier "reimplement behavior instead of copying" requirement is **resolved by accepting GPL** for these files (see `docs/TODO.md`). Streaming sources carry GPL-3.0 headers and live under `src/streaming/` + `src/aa/`, kept separate from the prediction-market product contracts.

## Current module map (shipped)

```text
solidity/
  Protocol.sol              set-once address book
  registries/MarketRegistry
  steward/StewardRegistry   default + per-market steward; resolveVault
  vault/{Vault, BondingBoard, Side}
  streaming/{DripsStreaming, Streams, Managed, Caller, IDrips}
  streaming/drivers/{SharedDriverUtils, MarketDriver, VaultDriver}
  treasury/{Treasury, LvstToken}
  aa/{LiveStreakPaymaster, AAImports}
```

**Removed:** `AddressDriver`, `BookmakerRegistry`, `VaultFactory`, `squeezeStreams` in drivers (primitive remains in `Streams.sol` unused).

### MarketRegistry (market index + stream pointer)

Per `marketId`, `streamState` holds a coarse on-chain pointer: `status` (`None` / `Live` / `Ended`), self-describing media ref `(scheme, id)` (`StorageScheme`: walrus-testnet / walrus-mainnet / ipfs / arweave), `updatedAt`, and `endedAt`. The market creator gates `goLive` and `setEnded`; `endedAt` is set once on the first end and never moved. After `endedAt + STREAM_LOCK_GRACE` (1 day), `isLocked` is true and `setEnded` can no longer revise the pointer. Rich manifest metadata stays off-chain; consumers resolve `marketId → current media` with a single keyed read.

### MarketDriver (per-market NFT, `tokenId == Drips account`)

`ERC721Enumerable` with `tokensOfOwner(address)` for holder enumeration (including transferred-in NFTs). Browser ABI-only consumers should use `@livestreak/contracts/evm/abis` (no `node:fs`).

≤ `MAX_LANES` (10) lanes across distinct vaults; **one side per vault**. Ops: `mint`, `fund`, `stop`, `stopAll`, **`setLanes`** (declarative reconcile — hedge is a side flip inside `setLanes`), `withdraw` (single + mass, optional `to` redirect for owner), `claimLossLvst`. No `switchSide`, `replaceLane`, `withdrawAll`, or both sides on one vault.

### VaultDriver (receiver-side)

Permissionless `createVault(marketId, question, seedSide, rate, deposit)`; `bootstrapStreaming`; `harvest`; seed `withdraw` / `stopSeed`.

### Vault (pure accounting)

Driver-gated `onFund` / `onStop`; **flow guard** (`Vault.advance` when board behind); `collect` harvest-on-cycle (short `CYCLE_SECS`); unified `withdraw` = winnings + overage. Settlement: **no squeeze** in drivers.

## Target Solidity Layout (historical — see module map above)

v0 contract set:

```text
src/
  market/             MarketRegistry
  bookmaker/          BookmakerRegistry
  vault/              Vault (+ streamed-funding Board), VaultFactory, Side, BondingBoard
  token/              LvstToken
  steward/            StewardRegistry
  streaming/          DripsStreaming, Streams, Managed, Caller, IDrips, drivers/AddressDriver
  aa/                 AAImports.sol, LiveStreakPaymaster.sol
  test/               Foundry tests (under packages/contracts/test/)
```

Naming may shift during implementation, but **responsibilities must not merge**:

- Market index ≠ vault pool math
- Vault creation ≠ consumer funding
- Steward decisions ≠ options reads
- LVST staking ≠ steward proposal staking

## Domain Model

### Market registry

**v0:** on-chain `MarketRegistry` for test simplicity.

```text
marketCount / marketIds
getMarket(marketId) -> title, streamId, category, status, createdAt, ...
getVaultIds(marketId) -> vaultId[]
```

**Later migration:** host/indexer holds canonical market catalog; chain keeps vault pools + resolution. Options read layer switches transport — contract shapes stay stable where possible.

Design rule: market id is stable; vault ids are children. No global flat `vaultIds[]` without market parent.

**v0 locked law:** `marketId = keccak256(abi.encode(observer, streamId))` via `computeMarketId`. Same `(observer, streamId)` may register once; different observers with the same `streamId` get distinct markets. `streamId` must be non-zero. `creator` is always `msg.sender`. Enumeration via `marketCount` / `marketIdAt` is retained for indexing; ids are not sequential counters.

**v0 vault creation:** permissionless `VaultDriver.createVault(marketId, question, seedSide, rate, deposit)` under an existing market. Bonded directional seed is mandatory. No `BookmakerRegistry` / `VaultFactory`.

### Vault model

```text
market has many vaults
each vault is binary YES / NO (v0)
vault stores:
  question, type, creator, status, outcome
  yesPool, noPool
  share totals per side (bonding-curve pricing — port from old Vault.sol)
  timing (created, expires, locked, resolved)
  steward/hot metadata (hotUntil, severity, disputeId, ...)
```

v0 curve (Slice A): independent per-side volume pricing — `price = BASE_PRICE + (BASE_PRICE * sideTotal) / CURVE_K` where `sideTotal` is that side's own pool. Contrarian NO-driver (NO priced from YES volume), YES time-decay, certainty multiplier, exponents, and per-vault curve params are deferred to a later curve-refinement slice (needs vault timing + certainty input). Vault timing fields (`createdAt` / `expiresAt` / duration) are deferred with that slice.

`getSharePrice(vaultId, side)` and `getVaultPools(vaultId)` are implemented. Funding now flows as **real USDC streams** priced on a per-(vault, side) **Board** (cumulative `g` index): shares accrue via `Vault.onFund` / `advance` / `settle`, not eager `creditPosition`. The old `creditPosition` / `VaultFunding` accounting path is removed — see `streamed-funding-explained.md`.

v0 keeps bonding-curve share pricing from old `packages/contracts` unless a later slice simplifies to flat pool weights. Funding streams drip USDC into the curve; they do not replace share accounting.

User positions are **per side**:

```solidity
position(user, vaultId, YES) -> shares, deposited, claimable, ...
position(user, vaultId, NO)  -> shares, deposited, claimable, ...
```

Hedging is required — never collapse YES/NO into one struct read for consumer packages.

### Funding streams (streamed funding — implemented)

Funding is a **real USDC stream** into one vault-side, priced fairly on the bonding curve. Full
mechanism: `streamed-funding-explained.md`. Shipped shape:

```text
AddressDriver.fund(vaultId, side, rate, deposit)   // consumer write: opens a Drips stream into the
                                                   //   vault-side AND seats you on the Board
AddressDriver.stop()                               // close the stream, refund unspent deposit
AddressDriver.settle(funder)                       // squeeze a live funder's in-flight cycle into the
                                                   //   vault-side at resolution (permissionless)
AddressDriver.claim(vaultId, side)                 // after resolution, pull winnings

Vault.onFund / onStop                              // driver-gated Board updates (settle-first)
Vault.advance / settle / pendingShares             // catch up the Board / bank / preview a funder
Vault.getBoard(vaultId, side)                      // pool, sideRate, g, lastAdvance
```

Each funder's USDC is custodied in `DripsStreaming` and streams in over time; shares accrue
continuously off the per-(vault, side) Board (one cumulative `g` index), priced by the closed-form
`ln` step in `BondingBoard`. You own your own sender account (the driver only operates the caller's
account); only the driver may move the Board (`onlyFundingDriver`). The old rate-accounting
`VaultFunding` / `setFundingRate` / `creditPosition` path is **removed**.

### Resolution + claims

```text
StewardRegistry.resolveVault(vaultId, outcome)   steward-gated; calls Vault.resolve (resolver=registry)  [REAL]
AddressDriver.settle(funder)                     squeeze a live funder's in-flight cycle pre-collect      [REAL]
Vault.collect(vaultId)                           drain both sides' streamed USDC out of Drips → pot       [REAL]
AddressDriver.claim / Vault.claimFor             winner takes pot·shares/sideShares (options: claimVault)  [REAL]
AddressDriver.reclaim / Vault.reclaimOverage     refund USDC streamed past resolvedAt (options: releaseVault) [REAL]

challenge(vaultId, proofRef) / finalize(vaultId) dispute window + terminal outcome (quorum + slashing)    [later]
```

v0 resolution authority is a single registered steward (`StewardRegistry.resolveVault`, gated by the
`stewards` mapping); the Vault's set-once `resolver` is the registry, so the factory can no longer
flip an outcome. Quorum scaling with steward count, a challenge window (reuse `disputeState`),
stake-weighting, and **slashing** a wrong resolver are the steward-mechanism slice.

Reads for options `ResolvedVaultView` and `OptionsFlowAccountView`:

```text
getVault(vaultId)                         status, outcome, resolvedAt, timing                       [REAL]
getPosition(vaultId, side, user)          rate, gPaid, sharesAccrued, maxEnd, depleted              [REAL]
pendingShares(vaultId, side, user)        live share preview (freezes at resolvedAt)                [REAL]
claimable(user, vaultId, side)            previewed USDC payout, view-parity with claimFor          [REAL]
winningSide(vaultId)                      which side won (post-resolution)                          [REAL]
getUserVaultIds(user)                     every vault a user funded (for listResolvedVaults)        [REAL]
overageOwed(vaultId, side, user)          refundable post-resolution overage (options: releaseVault)[REAL]
lossLvstClaimable(user, vaultId, side)    per-side LVST loss entitlement                            [LVST slice]
```

Old `withdraw(vaultId)` combined payout + LVST mint — split into explicit **claim paths**, **per-side loss LVST reads**, and optional aggregate helpers computed in options (not required on-chain for v0).

### LVST

Consumer LVST surface (options owns workflow, contracts own state):

```text
Reads:
  lvstBalance(user)
  lvstStaked(user)
  lvstPendingDividends(user)
  lossLvstClaimable(user, vaultId, side)   // per side — user may lose on one, win on other

Writes:
  claimLossLvst(vaultId, side)
  claimAndStakeLossLvst(vaultId, side)     // atomic claim + stake (old contracts lacked this)
  stakeLvst(amount)
  unstakeLvst(amount)
  claimDividends()                         // options encoder name: claimFlowDividends
```

v0 may deploy **one** `LvstToken` contract that implements balance + staking + dividends. Options config may still carry separate `lvstToken` and `flowStaking` address slots for forward compatibility — both may point at the same deployment in v0.

Keep **consumer LVST staking** separate from **steward proposal staking** (`StewardRegistry` stakes are governance-only).

**Implemented** (`src/token/LvstToken.sol`, proven in `test/token/LvstToken.t.sol`, all surface above is
[REAL]): losers mint LVST against their lost USDC at `LVST = lostUSD · mintRate()`, where `mintRate` is
a curve on the **cumulative** house pot — `floor + (start−floor)·knee/(knee+totalSkimmed)`, fat early
and tapering to a flat floor, cumulative so draining dividends can't reset it and farm cheap LVST. The
house pot is fed by a **winner-skim**: at resolution the Vault shaves `skimBps` (default 2%) off the
**losing** pool into LvstToken before winners split the rest — nothing when there is no opposing side
(everyone refunded). That skimmed USDC is the stakers' dividend (standard accumulator). The loss basis
is read back from the Vault (`Vault.lossClaimable`); LVST staking stays separate from steward staking.
`mintStart` / `mintFloor` / `mintKnee` / `skimBps` are owner-tunable. Design note: `lvst-token-economics`.

### Steward hooks

Contracts **store** hot/dispute state. Steward package **decides** and **submits** transactions.

```text
Reads:
  vaultHotState(vaultId)
  disputeState(vaultId)
  stewardProposal(proposalId)

Writes (steward-gated):
  triggerHot(vaultId, severity, until, reasonHash)
  endHot(vaultId)
  proposeAction(...)
  challengeProposal(...)
  executeProposal(...)

Writes (consumer, hot period only — port from old Vault.sol):
  exitDuringHot(vaultId, side)            // exit with burn per severity; hedging may require side argument
```

Old `onlyOwner triggerHot` must not survive — steward/registry gated instead.

### Schema / enum mapping

`@livestreak/schema` product vocabulary may differ from on-chain enums. This package owns the **contract → SDK** map in `src/constants/enums.ts`. Do not silently equate values.

| Domain | On-chain (v0 target) | Product schema (may differ) | Owner of mapping |
| --- | --- | --- | --- |
| Vault status | `Open`, `Hot`, `Locked`, `Resolved`, `Disputed` | `open`, `hot`, `locked`, `resolved`, `disputed` | `decode/vault.ts` |
| Vault outcome | `Pending`, `Yes`, `No` | `pending`, `yes`, `no` | `decode/vault.ts` |
| Steward tier | TBD in `StewardRegistry` | `community`, `professional`, `protocol` | `decode/steward.ts` |

Options snapshots use normalized string enums after decode — never raw uint8 in consumer packages.

## Three-Layer TypeScript Model

Mirror options' snapshot pattern at the chain boundary:

```text
Chain tuple / log       ->  Contract*State (`packages/contracts` decoders, later slice)
Contract*State         ->  consumed by options/bookmaker/steward snapshots
```

`@livestreak/contracts` exports **neutral contract state types** and decoders. Options projects them into `OptionsVaultView`, `OptionsResolvedVaultView`, and `OptionsFlowAccountView`.

```text
getMarket(marketId)              -> MarketState
getVault(vaultId)                -> VaultState
position(user, vault, side)      -> SidePositionState
fundingRate(user, vault, side)   -> FundingStreamState
flowAccount(user)                -> FlowAccountState
lossLvstClaimable(user,vault,side) -> bigint (part of FlowAccountState or vault user slice)
```

## Contract ↔ Options alignment

Canonical cross-package names. Solidity may use shorter names; **TS `write/` encoders and options call these targets**:

| Contracts (this package) | Options consumer call | Notes |
| --- | --- | --- |
| `AddressDriver.fund(vaultId, side, rate, deposit)` | `fundVault` | opens a USDC stream into the side |
| `AddressDriver.stop()` | `stopFunding` | closes the stream, refunds unspent |
| `claim(vaultId, side)` | `claimVault` | |
| `release(vaultId, side)` | `releaseVault` | |
| `claimLossLvst(vaultId, side)` | `claimLossLvst` | per side |
| `claimAndStakeLossLvst(vaultId, side)` | `claimAndStakeLossLvst` | |
| `stakeLvst(amount)` | `stakeLvst` | |
| `unstakeLvst(amount)` | `unstakeLvst` | |
| `claimDividends()` | `claimFlowDividends` | |
| `getUserVaultIds(user)` | `listResolvedVaults` input index | options filters by status |

Deployed address keys expected by options runtime config:

```ts
contracts: {
  marketRegistry: string;
  vault: string;           // Vault or Vault+Factory router — lock at deploy
  token: string;           // USDC
  lvstToken: string;
  flowStaking: string;     // may equal lvstToken in v0
}
```

## Reference Shape — `chains/evm/solidity/`

```text
packages/contracts/chains/evm/solidity/
  registries/   MarketRegistry
  vault/        Side, Vault (+ Board), BondingBoard
  treasury/     LvstToken, Treasury
  steward/      StewardRegistry
  streaming/    DripsStreaming, Streams, Managed, Caller, drivers/{MarketDriver,VaultDriver}
  aa/           AAImports.sol, LiveStreakPaymaster.sol
  Protocol.sol
```

TypeScript boundary: wagmi `generated/abis.ts` re-exported from `chains/evm/index.ts`. Deploy addresses: `deploy/output/<chain>.json` flattened in `chains/evm/addresses.ts`. Consumer import: `import { evm } from "@livestreak/contracts"`.

## Public API (`src/index.ts`)

**Export:**

- Artifact loaders and contract name/id types
- `MarketState`, `VaultState`, `SidePositionState`, `FundingStreamState`, `FlowAccountState`, enums
- Decode helpers (pure)
- Read/write call encoders (viem-ready; no Effect in this package)
- Deployment plan + address map validation
- Chain address registry types (`marketRegistry`, `vault`, `token`, `lvstToken`, `flowStaking`)

**Do not export as public center:**

- Bookmaker orchestration
- Options panel projection
- Steward rule evaluation
- Bundler server

## Contract Read Surface (v0 target)

These reads must exist so **options** can stop guessing:

### Markets

```text
marketCount() -> uint256
marketIdAt(index) -> bytes32
getMarket(marketId) -> MarketData
getVaultIds(marketId) -> bytes32[]
```

### Vaults

```text
getVault(vaultId) -> VaultData
getVaultPools(vaultId) -> yesTotal, noTotal, yesShares, noShares
position(user, vaultId, side) -> SidePositionData
getUserVaultIds(user) -> bytes32[]
vaultStatus(vaultId) -> enum
vaultOutcome(vaultId) -> enum
getSharePrice(vaultId, side) -> uint256          // bonding curve; options odds input
```

### Funding

```text
fundingRate(user, vaultId, side) -> uint256 ratePerSecond
fundingActive(user, vaultId, side) -> bool   // optional sugar: rate > 0
```

### Resolution / claims (reads)

```text
claimableUSDC(user, vaultId, side) -> uint256
released(user, vaultId, side) -> bool
resolvedAt(vaultId) -> uint256
winningSide(vaultId) -> enum
```

### LVST

```text
lvstBalance(user) -> uint256
lvstStaked(user) -> uint256
lvstPendingDividends(user) -> uint256
lossLvstClaimable(user, vaultId, side) -> uint256
emissionRate() -> uint256
```

### Steward / hot (reads)

```text
vaultHotState(vaultId) -> hot, until, severity, exitBurnBps, ...
disputeState(vaultId) -> active, challengeUntil, ...
```

Options maps these to `OptionsVaultSnapshot`, `OptionsResolvedVaultSnapshot`, `OptionsFlowAccountView`.

## Contract Write Surface (v0 target)

### Observer / observe edge (market registration)

```text
registerMarket(...) -> marketId     // when observe stream starts; references manifest/run/evidence
```

### Bookmaker-only (vault creation)

```text
createVault(marketId, ...) -> vaultId
```

Exact gating: `AgentRegistry`, role registry, or factory `onlyBookmaker` — lock in Solidity slice 1.

### Consumer (options / AA wallet)

```text
AddressDriver.fund(vaultId, side, rate, deposit)   // open a USDC stream into the vault-side
AddressDriver.stop()                               // close it; refund unspent
claim(vaultId, side)                          // options: claimVault
release(vaultId, side)                        // options: releaseVault
claimLossLvst(vaultId, side)
claimAndStakeLossLvst(vaultId, side)
stakeLvst(amount)
unstakeLvst(amount)
claimDividends()                              // options: claimFlowDividends
exitDuringHot(vaultId, side)                  // when vault status is Hot
```

### Steward

```text
triggerHot(vaultId, ...)
endHot(vaultId)
resolve(vaultId, outcome, proofRef)
challenge(vaultId, proofRef)
finalize(vaultId)
propose(...)
challengeProposal(...)
executeProposal(...)
```

### Agent / observer (bookmaker / observe track)

```text
registerAgent(...)          // AgentRegistry — bookmaker
registerObserver(...)       // ObserverRegistry — observe track (optional v0)
```

### Admin / deploy (script-only)

```text
wire registries, set token addresses, set thresholds
```

## AA / Bundler Integration

v0 execution path:

```text
app/cli -> WDK / 4337 wallet -> host POST /aa/bundler/:chain -> Alto/provider -> EntryPoint -> Vault/LvstToken
app/cli -> host POST /aa/paymaster -> sponsorship/signing data
```

Reference implementation quarry:

- `xylkstream/apps/server/src/interfaces/api/routes/bundler.ts` — chain-scoped JSON-RPC proxy to local Alto
- `xylkstream/apps/server/src/interfaces/api/routes/paymaster.ts` — paymaster route boundary
- `xylkstream/apps/packages/wdk-4337/` — wallet wrapper
- `xylkstream/apps/contracts/src/aa/XylkPaymaster.sol` — paymaster pattern

`@livestreak/contracts` does **not** host the bundler server. Top-level `host/` owns the bundler/paymaster HTTP routes. CLI/app discover those URLs from the host descriptor and pass them into WDK/write transports as normal runtime config.

No session keys in v0. Options accepts injected write transport that may be AA-backed.

## Old vs New (Explicit Gaps)

| Old `packages/contracts` | New re2 target |
| --- | --- |
| No `MarketRegistry` | `MarketRegistry` + `market -> vaultIds` |
| `Vault.createVault` open to agents | Bookmaker-gated create via factory/registry |
| Global `vaultIds` | Market-scoped vault index |
| `stream(amount)` one-shot | `setFundingRate` + drip state |
| Pause as separate concept | `rate == 0` |
| `getPosition(vault, user)` combined | `position(user, vault, side)` per call |
| LVST mint inside `withdraw` | Per-side `lossLvstClaimable` + `claimLossLvst(vault, side)` |
| No `claimAndStakeLossLvst` | `claimAndStakeLossLvst(vault, side)` |
| No `getUserVaultIds` | On-chain index of user vault participation |
| `onlyOwner triggerHot` | Steward-gated hot |
| `ProtocolLP.notifyDividends` uses `tx.origin` | Remove `tx.origin` reliance |
| `contracts-re` constructor args empty | Derive from Foundry artifact metadata |

## Boundaries With Downstream Packages

| Package | Reads | Writes |
| --- | --- | --- |
| **options** | markets, vaults, positions, funding rates, LVST account, resolved stats, `getUserVaultIds` | `setFundingRate`, `stop`, `claim`/`release`, LVST stake/dividend/loss claim, `exitDuringHot` |
| **observe edge** | market registry reads | `registerMarket` (stream start) |
| **bookmaker** | vault list under market, agent gating reads | `createVault`, `registerAgent` |
| **steward** | vault, hot, dispute, proposals | hot, resolve, challenge, finalize, proposal actions |
| **observe** | observer registry reads (optional) | `registerObserver`, batch submit (parallel track) |
| **host** | optional indexer mirror later; AA descriptor/bundler/paymaster provider details | bundler/paymaster HTTP routes, not contract state writes |
| **app/cli** | via options projection | via options + AA transport |

If a read or write is not listed here, do not add it without updating this doc and the consumer package architecture.

## What Good Code Looks Like

- Solidity enums match `src/constants/enums.ts` exactly.
- Every public read has a decoder in `decode/` and a typed wrapper in `read/`.
- Side is an explicit function argument — never a bool buried only in events.
- Foundry tests prove YES+NO simultaneous positions and rate-0 stop.
- Deployment plan generated from real artifact ABIs (fix `contracts-re` constructor gap).
- Events index `marketId`, `vaultId`, `user`, `side` for future indexer/host migration.

## What Should Not Be Built

Do not put market/vault creation on the options write surface.

Do not copy xylkstream privacy, circles, or yield into LiveStreak vault contracts.

Do not smear DripsRouter + prediction markets + AA into one Solidity module.

Do not use `tx.origin` for dividend or auth logic.

Do not treat `contracts-re` hand metadata as chain truth after Foundry lands.

Do not add session-key contracts in v0.

Do not let UI read raw `eth_call` tuples — export decoders from this package.

## First Build Slice

### Step A — architecture + enums

```text
docs/architecture.md                    (complete)
src/constants/enums.ts                  (next)
artifact name/id types
```

Acceptance: enum map documents schema differences; options can import status/outcome types.

### Step B — Solidity skeleton (Foundry)

```text
MarketRegistry
Vault + VaultFactory (binary YES/NO, market-scoped)
SidePosition storage
```

Acceptance: deploy locally; `registerMarket`, `createVault`, `position(user,vault,YES/NO)` reads work.

### Step C — funding streams (streamed funding — done)

```text
AddressDriver.fund/stop into vault-sides
Vault Board (advance/settle/pendingShares) + BondingBoard ln pricing
resolution: Vault.collect + claimFor (winner takes pot, loser = bounty)
```

Acceptance: shares accrue fairly over time (timing-independent); depletion caps pool == delivered
USDC; winners split the pot. Proven in test/vault/VaultBoard.t.sol + test/vault/VaultResolution.t.sol.

### Step D — resolution + claims + LVST

```text
resolve/finalize/challenge
claim/release reads
LvstToken loss claim + stake/dividends
claimAndStakeLossLvst
```

Acceptance: options can build `ResolvedVaultView` and `FlowAccountView` from reads only; per-side loss LVST is readable.

### Step E — steward hooks + TS package

```text
StewardRegistry hot/dispute writes
wagmi gen + consumer read adapters (e.g. packages/options/src/read/contracts/)
```

Acceptance: `@livestreak/options` imports wagmi ABIs and maps reads without guessing shapes.

### Step F — AA dev path

```text
document host AA URLs (quarry: xylkstream bundler/paymaster routes; LiveStreak host owns them)
wire paymaster + test UserOp for setFundingRate on local chain
```

LiveStreak AA reference quarry:

- `xylkstream/apps/server/src/interfaces/api/routes/bundler.ts` — proxies JSON-RPC to Alto
- `xylkstream/apps/server/src/interfaces/api/routes/paymaster.ts` — paymaster sponsorship/signing route

`@livestreak/contracts` does **not** host the bundler. Top-level `host/` owns `/aa/bundler/:chain` and `/aa/paymaster`; this package documents required deployed contract addresses and artifacts for those routes.

## Phased Delivery

### Slice 1 — registry + vault + positions

```text
on-chain market index
market -> vault ids
binary vault pools
position(user, vault, YES/NO)
```

### Slice 2 — funding streams

```text
rate per user/vault/side
rate 0 = stopped
no session keys
```

### Slice 3 — resolution + LVST

```text
winner side
claim/release
lossLvstClaimable + claimLossLvst
stake/unstake/dividends
```

### Slice 4 — steward + hot/dispute

```text
steward-gated hot
dispute/challenge/finalize metadata
bookmaker create gating hardened
```

### Slice 5 — indexer migration path (optional)

```text
host mirrors market catalog
contracts remain pool/resolution authority
options read transport switchable
```

## Delivery Order After Contracts

```text
contracts
bookmaker
steward
options implementation
host implementation
cli/gateway
```

Do not implement options write paths against placeholder ABIs. Freeze read/write names in this doc first, then Solidity, then TS decoders, then consumer packages.

## Relationship To Existing Instructions

| Document | Role |
| --- | --- |
| `packages/contracts/docs/architecture.md` | Chain authority, read/write surface, quarry map |
| `packages/bookmaker/docs/architecture.md` | Vault origination under observer-registered markets |
| `packages/options/docs/architecture.md` | Consumer projection — depends on this package |
| `host/docs/architecture.md` | Hosted distribution — optional market index later |
| `packages/observe/docs/architecture.md` | Media pipeline — orthogonal to vault math |

### How the layers fit together

```text
solidity/ (Foundry)
  -> src/read + decode (Contract*State)
  -> options/bookmaker/steward (workflows)
  -> app/cli (AA transport via host bundler/paymaster)
```

### Relationship to `-re`

`-re` quarries:

- `packages/contracts/*.sol` — mechanics
- `contracts-re/src/artifacts.ts` — ABI packaging shape
- `contracts-re/src/deployment-plan.ts` — wiring order ideas

Replace hand-maintained ABIs with Foundry artifact loading as soon as `solidity/` compiles. Keep enum maps; regenerate function lists from artifacts.

When porting mechanics, rearrange into market-scoped vaults + funding rates + explicit loss claims — do not port the old layout verbatim.
