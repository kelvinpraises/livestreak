# Local EVM dev stack — proven bring-up & full loop

> **Canonical operator path (board-first):** `host/docs/remote-console.md` + `context/temp-convo/GO-LIVE-SCOPE.md`  
> Use `settings init` → `auth login` → `remote open` → browser package tabs.  
> Sections §2–§4 below marked **LEGACY** describe the deleted `produce` CLI — kept for AA/paymaster
> debugging context only.

This document covers local EVM bring-up with real Account-Abstraction userOps (bundler +
verifying paymaster), no mocks. Verified against anvil on chain 31337.

## 0. Toolchain

- Node 22 (`.nvm/versions/node/v22.13.0`)
- Foundry 1.5.0 (`anvil`, `forge`, `cast`) on `PATH` (`~/.foundry/bin`)
- The host bundles `@pimlico/alto`; no separate bundler install is needed.

The repo is installed for production by default (`NODE_ENV=production`, npm `omit=dev`).
A fresh checkout needs dev deps once:

```sh
NODE_ENV=development npm install --include=dev --omit=
```

## 1. Boot everything — `./dev.sh`

```sh
./dev.sh
```

`dev.sh` (repo root) orchestrates, in order: kill stale procs → anvil (`--block-time 5`)
→ first-run `forge build` → deploy contracts (`npm run deploy -- --name localhost --force`,
deployer = anvil account #0) → host (`LIVESTREAK_AA_ALLOW_DEV_KEY=1 npm run dev`, executor +
paymaster signer = anvil #0, matching the deployed `verifyingSigner`) → app (`:3000`).

Confirm all three are up:

- anvil → `http://127.0.0.1:8545`
- host → `http://127.0.0.1:8787` (`curl …/aa/descriptor` lists chain 31337 with `bundlerPath`
  + per-chain `paymasterPath`)
- app → `http://localhost:3000` (HTTP 200)

Logs: `/tmp/livestreak-{anvil,host,app}.log`.

> The host runs from source via `tsx`, so host code changes take effect on a host
> restart (no build needed): `pkill -f "tsx src/main.ts"` then
> `cd host && LIVESTREAK_AA_ALLOW_DEV_KEY=1 npm run dev`.

## 2. CLI settings + auth (current)

```sh
cd cli
npm run dev -- settings init    # writes ./settings.json — host URL, chain, contracts
npm run dev -- auth login       # unlock keystore; seed in memory only
npm run dev -- remote open --scopes 'bridge:action:*,bridge:board:read' --ttl 30m
```

`settings init` reads the deploy artifact + host `/aa/descriptor` (per-chain `paymasterPath`).
`auth login` derives the AA Safe from the password seed (never written to disk).

Open the printed `/remote/<code>` URL in the app. See `host/docs/remote-console.md`.

### LEGACY — deleted `init` / `login` on `livestreak.json`

The old `init` + `login` + `livestreak.json` path was removed in the board-first CLI (`96292b3`).
Do not document it as canonical. If you see references in old tests or chat, use settings + remote instead.

## 3. Fund the operator with mock USDC (preflight)

Deploy funds anvil #0, not necessarily the derived operator Safe. Mint before remote `fund`:

```sh
USDC=<protocol.mockUsdc from packages/contracts/chains/evm/deployments/localhost.json>
OP=<operator Safe from `auth login` output>
cast send $USDC "mint(address,uint256)" $OP 1000000000 \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

There is no `faucet` CLI subcommand on the slim CLI — `cast` (or a `scripts/` helper) is intentional.

## 4. LEGACY — deleted `produce` live test

The gated `LIVESTREAK_LIVE=1` / `produce` e2e path was removed with the board-first CLI.
Keynote proof is **remote-console E2E** (`context/temp-convo/GO-LIVE-SCOPE.md`, agent-5 prompt).

Each on-chain step still uses real userOps through the host bundler + paymaster (~5s/block).

### 4a. LEGACY — settlement via deleted CLI commands

Resolve + claim + stake via remote Steward/Options tabs (canonical). Old one-liners:

```sh
# Steward resolve (cast) still valid for infra debugging:
cast send <stewardRegistry> "resolveVault(bytes32,uint8)" <vaultId> 2 \
  --rpc-url http://127.0.0.1:8545 --private-key <anvil#0 key>

# Deleted: cli claim / stake — use remote Options tab actions instead.
```

## Gotchas

- **Duplicate market / "market exists":** Observe `market.register` with the same operator +
  stream/run identity re-derives the same `marketId` → `MarketRegistry: market exists`
  (masked as `ExecutionFailed()` / `0xacfdb444`). **Remediation (board-first):** new Observe
  `system:config:configure` with a fresh run identity, or regenerate `settings.json` after
  `./dev.sh --force` deploy — **not** deleted `init`/`produce`.
- **Stale settings after deploy:** `settings init` must be re-run when `localhost.json`
  addresses change or AA simulation reverts with wrong contract targets.
- **Reverted userOp diagnosis:** Safe 4337 masks inner reverts as `ExecutionFailed()`
  (`0xacfdb444`). The host bundler proxy appends decoded `reason:` / `innerRevert:` to
  JSON-RPC error messages when possible. For full traces: `cast run <userOpHash>`.
- **Fresh-run after `./dev.sh --force`:** (1) `cd cli && rm -f settings.json && npm run dev -- settings init`
  (2) `remote open` with fresh scopes (3) new Observe `system:config:configure` runId — do **not**
  reuse stale marketIds or skip settings regen.
- **LEGACY stale file sink:** deleted `produce` wrote `/tmp/livestreak-<runId>.mp4`; remote
  observe runs use temp dirs under `observe-edge` — clear `/tmp/livestreak-remote-*` if needed.

## 5. Multichain: add the Sui-localnet leg

The local stack can run **both** chains at once so the app flips EVM↔Sui by config
alone (the app imports `localnetDeployment` from `@livestreak/contracts/sui` and selects
it via `setChain('sui')` — no rebuild, no code change). `./dev.sh` boots the Sui leg by
default; set `WITH_SUI=0` for the EVM-only stack.

### Toolchain (extra)

- `sui` CLI on `PATH` (`brew install sui`; verified on 1.73.0).
- A `sui client` env named `localnet` → `http://127.0.0.1:9000`, with an active address.
  `dev.sh` creates/switches it automatically (`sui client new-env --alias localnet …`).

### One command — `./dev.sh`

With `WITH_SUI=1` (default) `dev.sh` runs the EVM bring-up, then brings the Sui leg up
(the folded-in `sui_leg_up`), in order: kill stale `sui` → `sui start --with-faucet
--force-regenesis` (RPC `:9000`, faucet `:9123`) → faucet-fund the deployer + wait for a
gas coin → `npm run deploy:sui -- --name localnet --force` → faucet-fund the host gas
sponsor. It then starts the host with the Sui env exported so the host targets localnet:

- `LIVESTREAK_SUI_RPC_URL` / `SUI_RPC` = `http://127.0.0.1:9000`
- `LIVESTREAK_SUI_NETWORK` / `SUI_NETWORK` = `localnet`
- `LIVESTREAK_SUI_SPONSOR_MNEMONIC` = the localnet dev mnemonic (sponsor account is
  faucet-funded each run; localnet only, never a real network).

Logs: `/tmp/livestreak-sui.log`. The deploy rewrites
`packages/contracts/chains/sui/deployments/localnet.{json,ts}` — these are **ephemeral**
(regenerated every run from a fresh genesis); don't commit run-to-run churn.

### Sui leg

The Sui leg is folded into `dev.sh` (the `sui_*` helpers) — there's no separate script.
It comes up by default (`WITH_SUI=1`); pin the consoles to Sui with `CHAIN=sui ./dev.sh`.

### Flip the app to Sui

With the stack up, set the app's chain to `sui` (the chain toggle persists in
`sessionStorage` under `livestreak_chain`). The app then builds its chain config from
`localnetDeployment` via `createOptionsSuiConfig` — reads + sponsored writes go to
`:9000`. No env or rebuild needed on the app side.

### Verify (manual)

```sh
# Sui RPC alive:
curl -s -X POST http://127.0.0.1:9000 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"sui_getChainIdentifier","params":[]}'

# Deployed Protocol object resolves on-chain (proves the snapshot the app imports is live):
PKG=$(node -e "console.log(require('./packages/contracts/chains/sui/deployments/localnet.json').objects.protocol)")
curl -s -X POST http://127.0.0.1:9000 -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"sui_getObject\",\"params\":[\"$PKG\",{\"showType\":true}]}"

# Host gas sponsor is funded:
sui client gas 0x184692a4d95ec8c54940b58b501356d903c2c0bef8a5c215c3b4dd1551c325f6
```

### Gotchas (Sui)

- **`Cannot find gas coin for signer …`:** `--force-regenesis` wipes balances; the deploy
  tool's own faucet poke is racy. `dev.sh` pre-funds the active deployer and blocks on
  `sui client gas` before deploying — if you deploy by hand, faucet the active address first.
- **Deployer keypair:** `deploy:sui` uses the `sui client` active address' key when one is
  exportable, else falls back to the localnet dev mnemonic (localnet only — it refuses to
  sign on testnet/mainnet). The host sponsor uses that same dev mnemonic, derived at
  `m/44'/784'/0'/0'/0'` → `0x1846…25f6`.
