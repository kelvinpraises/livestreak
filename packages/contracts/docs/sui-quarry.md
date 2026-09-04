# Sui quarry — xylkstream Drips Move port → LiveStreak

Source quarry: `xylkstream-v1/contracts/sui/sources/` (read-only reference; not imported at build time).

Target: semantic parity with `chains/evm/solidity/` per `docs/architecture.md` + `docs/streamed-funding-explained.md`.

## Per-module verdicts

| Ref module | EVM analog | Verdict | Justification |
| --- | --- | --- | --- |
| `streams.move` | `Streams.sol` | **KEEP** | Quarried to `sources/streaming/streams.move` (`livestreak::streams`) |
| `drips.move` | `DripsStreaming.sol` | **KEEP** (trim) | `sources/streaming/drips.move` — collectable ledger, no splits/give/yield |
| `driver_utils.move` | metadata in drivers | **KEEP** | `sources/drivers/driver_utils.move` |
| `driver_transfer_utils.move` | `SharedDriverUtils.sol` | **KEEP** (trim) | `sources/drivers/driver_transfer_utils.move` — no splits/yield/give |
| `movemate i128` | native `int128` | **KEEP** | Quarried to `sources/i128.move` (`livestreak::i128`) |
| `movemate i256` | native `int256` | **KEEP** | Quarried to `sources/i256.move` (`livestreak::i256`) |
| `nft_driver.move` | `MarketDriver.sol` | **ADAPT** | `sources/drivers/market_driver.move` — `MarketPositionNFT` owned object; ≤10 lanes; native holder enum |
| (new) | `VaultDriver.sol` | **ADAPT** | `sources/drivers/vault_driver.move` — seed accounts, harvest, `createVault` |
| (new) | `Vault.sol` | **ADAPT** | `sources/vault/vault.move` + `bonding_board.move` — full streamed-funding Board |
| (new) | `MarketRegistry.sol` | **ADAPT** | `sources/registries/market_registry.move` + `protocol.move` |
| (new) | `StewardRegistry.sol` | **ADAPT** | `sources/steward/steward_registry.move` — resolve + hot/dispute (challenge quorum deferred) |
| (new) | `Treasury.sol` / LVST | **ADAPT** | `sources/treasury/treasury.move` + `lvst.move` |
| `splits.move` | (unused in EVM) | **DROP** | Removed from EVM drivers; no product use |
| `address_driver.move` | `AddressDriver` (removed) | **DROP** | EVM removed; NFT driver replaces |
| `yield_manager.move` | (none) | **DROP** | No EVM analog in LiveStreak protocol |

## Sui-native divergences (confirmed)

| EVM pattern | Sui approach |
| --- | --- |
| ERC-4337 / Paymaster | Sponsored transactions (no AA port) |
| `ERC721Enumerable` | Native owned-object enumeration |
| `onlyOwner` / `msg.sender` | Capabilities + `tx_context::sender` |
| `IERC20` USDC / LVST | `Coin<USDC>` / `Coin<LVST>` |
| `bytes32` stream pointer | `(StorageScheme, id)` on `MarketRegistry` — `id` as `vector<u8>` / string cap 64 on Sui |

## Stage status

| Stage | Status |
| --- | --- |
| 0 — Scaffold + math libs | **done** (`7ac6480`) |
| 1 — Streaming substrate | **done** (`437323c`) |
| 2 — Drivers | **done** (`4358520`) |
| 3 — Product contracts | **done** (this run) |
| 4 — Reads + kit | pending |
| 5 — Parity verification | pending |
