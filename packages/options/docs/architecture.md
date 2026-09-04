# @livestreak/options — architecture (R7)

Consumer SDK for LiveStreak prediction markets. Maps on-chain `MarketDriver` / `Vault` /
`Treasury` state into typed snapshots, UI panels, and authorized bridge actions.

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
| Vault reads use `tokenId` | `getPosition`, `claimable`, `lossClaimable`, `pendingShares` take `tokenId` |

Side enum on-chain: `yes = 0`, `no = 1`.

## Layering

```text
chains/           protocol operations (OptionsReader / OptionsWriter, per-chain)
  evm/            abis · addresses · encode · decode · reader · writer
  sui/            notImplemented stub (drops in when contracts exist)
model/            pure domain types + model/math/ + model/validate.ts
flows/            snapshot · claims · pnl · stream orchestration over chain.reader
bridge/           authorized outward edge (readBoard / readControls / callAction / subscribe / watch)
  panel/          UI projection (bigint → string, action flags)
runtime/          polling + board assembly + subscription registry + session memory
```

Dependency order: `chains` → `model` → `flows` → `runtime` / `bridge`.

```text
app / CLI
  ├── createOptionsChain(chainConfig)     → chains/{evm|sui}
  │     EVM reads:  viem publicClient (RPC from config)
  │     EVM writes: createWalletManager → AA userOp → poll receipt → TxId
  ├── createOptionsRuntime({ config, chainConfig })
  └── createOptionsBridge({ runtime })    → scope-gated external API
```

There are **no** injected `ContractReader` / `ContractWriter` ports and no generic
`ChainReadRequest` / `chain.reader.read` escape hatches.

## Chain boundary

### OptionsReader (~22 ops)

Domain-typed reads: `readMarket`, `readVault`, `readNft`, `readClaimable`,
`readWinningSide` (guarded: only when `vault.status === "resolved"`), etc.

### OptionsWriter (~12 ops)

Domain-typed writes returning branded `TxId`: `fund`, `setLanes`, `stopFunding`,
`stopAllFunding`, `withdraw`, `withdrawMany`, `claimLossLvst`, `stakeLvst`,
`unstakeLvst`, `claimDividends`, `transferNft`, `approveNft`, `setApprovalForAll`.

### encode vs validate

| Layer | Responsibility |
| --- | --- |
| `chains/evm/encode.ts` | bytes32 coercion, `0x` address regex, `sideToSolidityValue` |
| `model/validate.ts` | pure domain rules: rate > 0, tokenId ≥ 0, non-empty branded ids |

## Bridge

Vanilla Promises (no `Effect`). Mirrors observe bridge shape:

| Scope | Method |
| --- | --- |
| `bridge:board:read` | `readBoard(caller)` |
| `bridge:controls:read` | `readControls(caller)` |
| `bridge:action` | `callAction(caller, envelope)` → `TxId` |
| `bridge:board:subscribe` | `subscribeBoard(caller, listener)` / `watch(caller, key, listener)` |

`BridgeCaller.trusted === true` short-circuits grant checks. Otherwise `CapabilityGrant`
records are evaluated via `requireAnyScope`.

Writes from external callers go through `callAction` — standalone `write/*` helpers are
not public exports.

## Runtime

`createOptionsRuntime` owns:

- `chain` (from `createOptionsChain` or injected fake in tests)
- in-memory snapshot store (`set` / `get` session memory map)
- `readBoard` / `subscribeBoard` via `runtime/board.ts` + `subscriptions.ts`
- optional polling when `refreshIntervalMs` is set

## Public exports (`src/index.ts`)

Exported: `createOptionsChain`, `createOptionsBridge`, `TxId`, flow reads, bridge panel
projection, runtime, model/math.

Not exported: `createOptionsReader`, `OptionsReadTransport`, generic chain requests,
standalone write helpers, `getStreamMedia`, `ContractReader`/`ContractWriter`.

## Verify

```bash
cd packages/options && npm run check && npm run build && npm test
```
