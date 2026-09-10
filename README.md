# LiveStreak

Live video prediction markets, settled on-chain. Any live stream — football, esports, debates —
becomes a surface for real-time binary options: CV agents watch the stream, generate prediction
options, and stake their own capital; viewers stream USDC onto YES/NO sides via floating
"Niko-Niko" cards over the video. The loss-to-ownership token is **$LVST**.

---

## At a glance

| | |
| --- | --- |
| **Sui** | Move protocol on **testnet** — sponsored transactions, shared-object registries, `LiveStreakSuiClient` |
| **EVM** | Foundry + **ERC-4337 Safe** — localhost dev stack; bundler/paymaster via host |
| **Walrus** | Stream VOD, market stream metadata, steward durable memory (via host) |
| **Operator** | Board-first **remote console** — browser drives package actions; seed stays in CLI keystore |

The app flips **EVM ↔ Sui** by config alone — same UI, different deployment snapshot.

---

## Live on Sui testnet

Deployed **2026-06-21**. Canonical snapshot:
[`packages/contracts/chains/sui/deployments/testnet.json`](packages/contracts/chains/sui/deployments/testnet.json)

| | |
| --- | --- |
| **RPC** | `https://fullnode.testnet.sui.io:443` |
| **Package** | [`0x405f99…49200e`](https://suiscan.xyz/testnet/object/0x405f99daf3690baf6211783e1492c86c4c600ed1d0a0e6aadcd7b992d149200e) |
| **Protocol** | `0xe983e2108a3ab870399b1c08453eaaf750c495ef63854b216ae5288bb194be00` |
| **Market registry** | `0x45d4acbfb9d0383f0e682c2636f7edf07367d7046585b1b53dc279a30131b66d` |
| **Vault registry** | `0xab2432ade27f45a7970cc4168f15469fd27cbde6a142bdb3e3e755fd530e1a96` |
| **Steward registry** | `0x415e43223f347f73bf6956d2427b619c1ac7758568c89380ce0a4f0841ecd598` |
| **Treasury registry** | `0x3f510590fd5135324993dde628bf1f27a228fc2567d8e0acb7c5d782b4f7b83f` |
| **Drips registry** | `0xab4a571838f64478adb6d239b1cdc53891eea118e8312e8c1c7615d7e50aac6c` |
| **Streams registry** | `0x208fe9b51eee0d050eed13a31c87059c046028b501c62e5f0901e9a4140e73c7` |
| **Market driver** | `0xb3293e6b7ef15be9b7043e987ca255da257e573cfdf9e780f373df427079ac6c` |
| **Vault driver** | `0xa41e6ff9c70b77965b7ac9d66bfeef063b1c3623c4a741244e1773a442c212b3` |
| **LVST treasury cap** | `0x3065ea9f9e57d54aad93616dd1d14a7c276c1726cb101f9ddbf5bb6a59557a3d` |
| **Mock USDC mint cap** | `0x7c7e8723edac3a6e71a6caba5d09bc0c433452b8b63552147dbb8a9b041831b4` |

```ts
import { testnetDeployment } from "@livestreak/contracts/sui/deployments/testnet";
import { LiveStreakSuiClient } from "@livestreak/contracts/sui";

const client = new LiveStreakSuiClient({ deployment: testnetDeployment });
```

Redeploy: `cd packages/contracts && npm run deploy:sui -- --name testnet`

Full contract docs: [`packages/contracts/README.md`](packages/contracts/README.md)

---

## EVM (localhost dev)

| Environment | Snapshot |
| --- | --- |
| **Localhost** | [`packages/contracts/chains/evm/deployments/localhost.json`](packages/contracts/chains/evm/deployments/localhost.json) |
| **Public testnet** | Not deployed |

AA stack (EntryPoint, Safe4337 module, paymaster) ships with `./dev.sh`. Imports:

```ts
import { localhostDeployment } from "@livestreak/contracts/evm/deployments/localhost";
import { evm } from "@livestreak/contracts";
```

---

## How it works

```
[stream] → observe (capture → process → publish)
                ↓ market.register + Walrus stream pointer
         options (fund YES/NO vaults, claim)
                ↓
         steward (resolve, accountability)
                ↓
         $LVST (loss → ownership token)
```

**Operator model.** Packages expose **control boards** and scoped bridge actions. The CLI is a thin
gateway (`settings`, `auth`, `keystore`, `remote`) — it does not orchestrate observe → options in one
command. Instead, `remote open` registers a session; the operator drives each package from browser tabs
(**Observe · Options · Bookmaker · Steward**), copies `marketId` across tabs, and the seed never crosses
the wire. Details: [`host/docs/remote-console.md`](host/docs/remote-console.md)

---

## Run locally

**Prereqs:** Node 22+, Foundry (EVM). Sui CLI for the multichain leg (`brew install sui`).

```shell
./dev.sh              # Sui localnet + Anvil + deploy + host + app (default)
WITH_SUI=0 ./dev.sh   # EVM only
```

| Service | URL |
| --- | --- |
| App | `http://localhost:3000` |
| Host | `http://127.0.0.1:8787` |
| Sui localnet | `http://127.0.0.1:9000` (faucet `:9123`) |
| EVM (Anvil) | `http://127.0.0.1:8545` |

Sui localnet snapshot: [`packages/contracts/chains/sui/deployments/localnet.json`](packages/contracts/chains/sui/deployments/localnet.json)

### Remote console

Operator controls packages from the browser; seed stays in the CLI:

```shell
cd cli && npm run build
node dist/main.js settings init
LIVESTREAK_PASSWORD='<password>' node dist/main.js remote open \
  --scopes 'bridge:action:*,bridge:board:read' --ttl 30m
```

Open the printed URL, enter the pairing password.

---

## Repository layout

### Applications

| Path | Role |
| --- | --- |
| [`app/`](app/) | React SPA — discovery, stream viewer, position console, **remote bridge console** |
| [`host/`](host/) | Server edge — sessions, **Walrus** content + memory, stream catalog, AA bundler/paymaster proxy, remote WSS relay |
| [`cli/`](cli/) | Operator gateway — `settings`, `auth`, `keystore`, `remote` |

### Domain packages

| Path | Role |
| --- | --- |
| [`packages/observe`](packages/observe) | Video pipeline (capture → process → publish), run lifecycle, control bus; **Walrus**-backed stream pointers on go-live |
| [`packages/options`](packages/options) | Consumer SDK — read markets/vaults/positions, runtime, fund/claim writes (EVM + Sui) |
| [`packages/bookmaker`](packages/bookmaker) | Vault origination: detect → similarity → create/join |
| [`packages/steward`](packages/steward) | Accountability workflow — facts → rules → decisions → action plans; durable recall via host **Walrus** memory |

### Shared libraries

| Path | Role |
| --- | --- |
| [`packages/schema`](packages/schema) | Wire types — descriptors, remote protocol, settings, wallet init, capability grants |
| [`packages/core`](packages/core) | Shared Effect errors and utilities |
| [`packages/wallet`](packages/wallet) | ERC-4337 Safe wallet SDK |
| [`packages/host`](packages/host) | Shared host / Walrus descriptor types (imported by app + host server) |

### Contracts — multichain

[`packages/contracts`](packages/contracts) — Sui Move + Solidity (Foundry) + typed deployment snapshots.

**Sui Move** (`chains/sui/sources/`)

| Module | Purpose |
| --- | --- |
| `market_registry` | Market identity + registration |
| `vault` / `bonding_board` / `side` | YES/NO vaults, bonding curve board |
| `treasury` / `lvst` | Protocol treasury, **$LVST** token |
| `steward_registry` | Steward accountability registry |
| `drips` / `streams` | Streamed funding + stream lifecycle |
| `market_driver` / `vault_driver` | On-chain wire drivers |
| `driver_registry` / `protocol` | Driver routing + protocol bootstrap |
| `mock_usdc` | Test USDC (9 decimals on Sui) |

**EVM Solidity** (`chains/evm/solidity/`)

| Contract | Purpose |
| --- | --- |
| `MarketRegistry` | Market identity + registration |
| `Vault` | YES/NO vaults + resolution |
| `Treasury` / `LvstToken` | Protocol treasury, **$LVST** (18 decimals) |
| `StewardRegistry` | Steward registry |
| `Drips` (streaming) | Streamed funding |
| `MarketDriver` / `VaultDriver` | On-chain wire drivers |
| Safe **4337** module stack | Account abstraction + sponsored userOps |

Parity tests on both chains include conservation invariants and stream lifecycle coverage.

---

## Build & test

```shell
npm install && npm run build && npm run test
```

| Target | Command |
| --- | --- |
| Sui Move | `cd packages/contracts/chains/sui && sui move test --build-env testnet` |
| EVM | `cd packages/contracts/chains/evm && forge test` |
| Sui deploy | `cd packages/contracts && npm run deploy:sui -- --name testnet` |
| EVM deploy | `./dev.sh` (or `npm run deploy -- --name localhost --force` in `packages/contracts`) |
