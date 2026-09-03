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
chains/evm/solidity/
  Protocol.sol
  registries/MarketRegistry.sol
  steward/StewardRegistry.sol
  vault/{Vault, BondingBoard, Side}.sol
  streaming/{DripsStreaming, Streams, Managed, Caller, IDrips}.sol
  streaming/drivers/{SharedDriverUtils, MarketDriver, VaultDriver}.sol
  treasury/{Treasury, LvstToken}.sol
  aa/{LiveStreakPaymaster, AAImports}.sol
```

---

## Shipped (current model)

- [x] `MarketDriver` NFT driver — ≤10 lanes, one side per vault, `setLanes` hedge
- [x] `VaultDriver` — permissionless bonded seed `createVault`, `harvest`, seed withdraw
- [x] Flow guard — `Vault.advance` + `caughtUp`; fund reverts when board behind
- [x] Harvest-on-cycle settlement (no driver `squeeze`)
- [x] `StewardRegistry` — default + per-market steward override
- [x] `Treasury` split — skim, loss-mint LVST, stake, dividends
- [x] Typed kit — `evm.contract(name)` + `deployments/*.json`
- [x] Deploy scopes + `npm run deploy` / `npm run e2e` (AI Labs Live Demo Day stress story)
- [x] `forge test` — 118/0

**Removed / dead:** `AddressDriver`, `BookmakerRegistry`, `VaultFactory`, `squeeze`/`settle`/`claim`/`reclaim` driver paths, simultaneous YES+NO on one vault.

---

## Active Slice — File Grouping Cleanup

- [x] Move from broad `src/protocol/` grouping to owner/domain folders
- [x] Keep Solidity under `chains/evm/solidity/` only
- [x] Keep TS limited to deploy orchestration and wagmi-generated ABI/types
- [x] Update imports, wagmi config, Foundry tests, docs
- [x] Run forge + wagmi verification

Current layout (see [architecture.md](./architecture.md) **Current module map**):

```text
chains/evm/solidity/
  Protocol.sol
  registries/MarketRegistry.sol
  steward/StewardRegistry.sol
  vault/{Vault, BondingBoard, Side}.sol
  streaming/{DripsStreaming, Streams, Managed, Caller, IDrips}.sol
  streaming/drivers/{SharedDriverUtils, MarketDriver, VaultDriver}.sol
  treasury/{Treasury, LvstToken}.sol
  aa/{LiveStreakPaymaster, AAImports}.sol
```

---

## Locked Skeleton Decisions (current)

- [x] Market ids: `keccak256(abi.encode(observer, streamId))` — `streamId` must be non-zero
- [x] Vault creation: permissionless `VaultDriver.createVault` with bonded directional seed (no `BookmakerRegistry`)
- [x] Funding: `MarketDriver` NFT — ≤10 lanes, one side per vault; hedge via `setLanes`
- [x] LVST: `Treasury` loss-mint + stake + skim dividends
- [x] GPL Drips mining accepted under `streaming/`
- [ ] Full AA stack — host owns bundler routes; contracts deploy Solidity pieces when needed

---

## Core Writes (current)

- [x] `registerMarket` / `MarketRegistry`
- [x] `VaultDriver.createVault` + seed lifecycle
- [x] `MarketDriver` — `mint`, `fund`, `stop`, `stopAll`, `setLanes`, `withdraw`, `claimLossLvst`
- [x] `StewardRegistry.resolveVault` → `Vault.resolve`
- [x] `Vault.collect` / `harvest` / `withdraw` / `advance`
- [ ] steward challenge / finalize / penalty / veto surfaces (quorum + slashing)

---

## Core Reads (current)

- [x] Markets: `marketCount`, `marketIdAt`, `getMarket`, `getVaultIds`, `marketExists`
- [x] Vaults: `getVault`, `getPosition`, `getBoard`, `pot`, `lossClaimable`, `caughtUp`
- [x] `pendingShares` / streamed Board replay
- [x] Steward-visible hot/dispute metadata
- [ ] resolution helper reads consolidated for options consumers

---

## Historical notes (superseded)

<details>
<summary>Pre–MarketDriver skeleton (AddressDriver / VaultFactory era)</summary>

- Bookmaker gate via `BookmakerRegistry` + `VaultFactory.createVault`
- `AddressDriver.fund`/`stop`/`settle`/`claim`/`reclaim` with driver `squeeze`
- Simultaneous YES+NO on one vault

See git history before the vault re-tune. **Do not implement against this surface.**

</details>

---

## Next Behavior Slices

### Deploy + e2e regression

- [x] `npm run deploy -- --name localhost` (scopes: aa, streaming, protocol, wire, paymaster)
- [x] `npm run e2e` — AI Labs Live Demo Day stress story (≥12 vaults, edge matrix, conservation ledger)
- [x] Promote `deploy/output/localhost.json` → `deployments/localhost.json` for typed kit

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
