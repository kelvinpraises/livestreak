# @livestreak/options — architecture

Consumer SDK for LiveStreak prediction markets on EVM. The package maps on-chain
`MarketDriver` / `Vault` / `Treasury` state into typed snapshots and UI panels. It
does **not** own wallets, signing, or deployment — those live at the app / CLI edge.

## NFT-lane account model

Positions are keyed by **ERC-721 token id**, not `(user, vault, side)`.

```text
owner (EOA) ──owns──▶ MarketDriver NFT (tokenId)
                         └── lanes[]: { vaultId, side, rate, … }
```

| Rule | Meaning |
| --- | --- |
| One side per vault per NFT | Each lane picks YES **or** NO for a vault |
| Multi-vault exposure | Add lanes on the same NFT, or hold multiple NFTs |
| Multi-NFT holders | `MarketDriver.tokensOfOwner(owner)` lists all token ids |
| Vault reads use `tokenId` | `getPosition`, `claimable`, `lossClaimable`, `pendingShares` take `tokenId` as the account arg |

There is no “hold both sides on one lane” product path. Opposing exposure requires
separate NFTs (or separate vault lanes on different sides across NFTs).

## Layering

```text
panel/          UI projection (bigint → string, action flags)
read/           transport + snapshot assembly
model/          pure domain types, curve math, accrual projector
write/          Effect-free write blueprints → injected ContractWriter
runtime/        polling loop at the app edge
```

Dependency order: `model` → `read` / `write` → `panel` / `runtime`.

### Purity

- `model/`, `panel/`, `read/snapshot.ts` — vanilla TypeScript, no `Effect.run*`.
- `write/` returns encoded requests; the host calls `ContractWriter.write`.
- ABIs import **only** from `@livestreak/contracts/evm/abis` (never `@livestreak/contracts/evm`).

### Wallet boundary

```text
app / CLI
  ├── ContractReader  ──▶ createContractsOptionsReadTransport
  ├── ContractWriter  ──▶ createContractsOptionsWriteTransport
  └── createOptionsRuntime (poll + panel refresh)
```

`@livestreak/wallet` must not appear in `packages/options/src`.

## On-chain roles

| Contract | Role in this SDK |
| --- | --- |
| `MarketRegistry` | Markets, vault index per market |
| `MarketDriver` | NFT mint, `tokensOfOwner`, `laneAt`, `setLanes`, funding controls |
| `Vault` | Pools, positions, bonding board, claims, resolution |
| `StewardRegistry` | Hot / dispute overlay on vault reads |
| `Treasury` | LVST staking + dividend reads |
| `LvstToken` | LVST balance |

Side enum on-chain: `yes = 0`, `no = 1`.

## Read transport

`OptionsReadTransport` is the seam for all chain reads. The contracts adapter
(`createContractsOptionsReadTransport`) takes an injected `ContractReader`.

### Core reads (R1)

- Markets: `readMarket`, `listMarketVaults`
- Vaults: `readVault`, `readVaultShareTotals`
- NFTs: `listOwnerTokens`, `readNft` (lanes from `laneAt` + `getPosition`)
- LVST: `readLvstAccount`

### Claim previews (R2)

| Method | On-chain | Notes |
| --- | --- | --- |
| `readClaimable(tokenId, vaultId, side)` | `Vault.claimable` | Winner payout preview |
| `readLossClaimable(tokenId, vaultId, side)` | `Vault.lossClaimable` | Loser USDC basis for LVST |
| `readWinningSide(vaultId)` | `Vault.winningSide` | **Only after** `status === resolved` |
| `readPot(vaultId)` | `Vault.pot` | Non-zero after collection |
| `readCollected(vaultId)` | `Vault.collected` | |
| `readAccountVaultIds(tokenId)` | `Vault.getAccountVaultIds` | All funded vaults for token |

`readNft` enriches each lane with `claimable`, `lossClaimable`, and `won`
(`side === winningSide` when resolved). `readVaultSnapshot` adds `winningSide`,
`pot`, and `collected` for resolved vaults.

⚠️ **Never call `winningSide` on open vaults** — it reverts. The transport reads
`getVault` first and returns `undefined` unless status is `resolved`.

### Live ln() ticker (R2)

Bonding curve constants (display layer): `BASE_PRICE = 100_000`,
`CURVE_K = 10_000_000_000`, `SHARE_SCALE = 1_000_000`, `WAD = 1e18`.

| Method | On-chain |
| --- | --- |
| `readBoard(vaultId, side)` | `getBoard` → pool, sideRate, g, lastAdvance |
| `readSharePrice(vaultId, side)` | `getSharePrice` |
| `readPendingShares(vaultId, side, tokenId)` | `pendingShares` |

`projectShares` advances `g` locally via `segMath` (`Math.log` display estimate).
`projectStreamAccrual` builds `OptionsStreamAccrualView`:

- `pendingShares` — projected or frozen `pendingShares`
- `valueUSDC` — `pendingShares × (yesTotal + noTotal) / sideShareTotal`
- `sharesPerSec` — finite difference over 1s (zero when frozen)
- `sharePriceNow` — `priceOf(board.pool)`

Freezes when the lane is depleted, past `maxEndMs`, or past `resolvedAtMs`.
Re-anchors on every fresh `readPendingShares` RPC read.

## Snapshots and panel

```text
readUserOptionsSnapshot(transport, user, marketId?)
  → OptionsUserOptionsSnapshot
  → projectOptionsPanel(snapshot)
  → OptionsPanel
```

Lane panel fields (R2): `claimableUSDC`, `lossClaimableLVST`, `won`,
`canClaimWin`, `canClaimLoss`.

## Write transport

NFT-lane writes only (no vault/market creation in this package):

- `fundStream`, `setLanes`, `stopFunding`, `stopAll`
- `withdraw`, `withdrawMany`
- `claimLossLvst`
- `stakeLvst`, `unstakeLvst`, `claimDividends`
- NFT: `transferNft`, `approveNft`, `setApprovalForAll`

## Tests

- Unit: model curve, accrual projector, panel projection, transport mapping
- Guards: no `Effect.run*` in `src/`, ABI import path, `winningSide` guard
- Fakes: `test/helpers/fake-transport.ts` implements full `OptionsReadTransport`

## R3 — aggregation + app-integration (complete)

### Drips + USDC reads

`OptionsContractAddresses` includes `dripsStreaming`. `readUsdcAddress()` caches
`MarketDriver.USDC()`. `readNftBalance(tokenId)` calls
`DripsStreaming.streamsState(tokenId, usdc)` and maps tuple index **3** (`balance`,
`uint128`) as `remainingUSDC`.

### Session PnL

`readSessionPnl(transport, user, investedUSDC?)` → `OptionsSessionPnlView`:

| Field | Fold |
| --- | --- |
| `returnedUSDC` | Σ `claimable(tokenId, vault, winningSide)` on resolved vaults |
| `lossBasisUSDC` | Σ `lossClaimable(tokenId, vault, losingSide)` |
| `remainingUSDC` | Σ `readNftBalance(tokenId)` across `tokensOfOwner` |
| `investedUSDC?` | Caller-supplied only — never invented |
| `netPnlUSDC?` | `returned + remaining − invested` when invested is supplied |

### Claims view

`readClaimsView(transport, user)` → `OptionsClaimsView` spanning all NFTs via
`tokensOfOwner` → `getAccountVaultIds` + lane enrichment. Reuses R2 claim reads.

### Runtime memory

`OptionsRuntime.set(key, value)` / `get(key)` — in-memory map on the store (reconstructable).
`onChange(cb)` fires on `set` **and** snapshot refresh; returns unsubscribe. `subscribeSnapshots`
remains snapshot-only.

### Panel (R3 flags)

- LVST: `canStake`, `canUnstake`, `canClaimDividends` (unchanged logic, explicit tests)
- Market: `totals.totalPooledUSDC` = Σ `(yesTotal + noTotal)` over market vaults
- NFT: `owner`, `approved`, `isOperator` from `ownerOf` / `getApproved` / `isApprovedForAll`

**Next step (app package):** wire `/stream` mock hooks to injected viem reader + `createOptionsRuntime`.
