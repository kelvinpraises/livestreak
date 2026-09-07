# Local EVM dev stack — proven bring-up & full loop

This is the canonical, **verified** path to run the whole keynote loop on a local EVM
stack with real Account-Abstraction userOps (bundler + verifying paymaster), no mocks.
Every step below was run end-to-end against anvil on chain 31337.

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

## 2. CLI init + login

```sh
cd cli
npx tsx src/main.ts init \
  --deployment ../packages/contracts/chains/evm/deployments/localhost.json \
  --host http://127.0.0.1:8787 \
  --network testnet \
  --out /tmp/livestreak.json

LIVESTREAK_PASSWORD='<password>' npx tsx src/main.ts login --config /tmp/livestreak.json
```

`init` reads the deploy artifact + the host `/aa/descriptor` and consumes the **per-chain**
`chains[].paymasterPath`. `login` derives the AA smart-account address from the password
seed (seed never written to disk) and caches the public address as `run.operator`.

> The host advertises `walrus.network: null` locally, so `--network testnet` must be
> passed explicitly (init can't infer it).

## 3. Fund the operator with mock USDC

The mock USDC has an open `mint(address,uint256)` faucet (no pre-mint to the deployer):

```sh
USDC=<protocol.mockUsdc from the deployment>
OP=<run.operator from /tmp/livestreak.json>
cast send $USDC "mint(address,uint256)" $OP 1000000000 \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## 4. Run the full loop

The gated live test drives produce → vault create → nft mint → fund → withdraw:

```sh
cd cli
LIVESTREAK_LIVE=1 \
LIVESTREAK_CONFIG=/tmp/livestreak.json \
LIVESTREAK_PASSWORD='<password>' \
LIVESTREAK_VIDEO=/path/to/clip.mp4 \
  npx vitest run test/e2e.live.test.ts
```

Each step is a real userOp through the host bundler + verifying paymaster, ~5s/block, so
the run takes ~2 minutes. `produce` registers the market + fires the observe
go-live/set-ended lifecycle, uploads the VOD to the host's local content store, and
publishes the VOD pointer on-chain.

### 4a. Settlement → LVST loss-mint → stake

The live test stops at `withdraw`; the loss-mint + stake path needs the vault **resolved**
first (the default steward is anvil #0). To prove it end-to-end:

```sh
# Resolve the funded vault against its YES side (Outcome.No = 2), as the steward:
cast send <stewardRegistry> "resolveVault(bytes32,uint8)" <vaultId> 2 \
  --rpc-url http://127.0.0.1:8545 --private-key <anvil#0 key>

# Loss-claim mints LVST to the operator, then stake it:
npx tsx src/main.ts claim --vault <vaultId> --side yes --loss --config /tmp/livestreak.json
npx tsx src/main.ts stake --amount 1 --config /tmp/livestreak.json
```

`claimLossLvst` mints LVST (verified: 200 LVST for the test position); `stake` moves it
into the treasury (LVST balance drops by the staked amount).

## Gotchas

- **Sticky runId / "market exists":** `login` persists `run.runId`, and `produce` reuses
  it, so re-running `produce` against the same config re-derives the same `marketId` and
  reverts with `MarketRegistry: market exists` (masked by the Safe module as
  `ExecutionFailed()` / `0xacfdb444`). Re-run `init` (which clears `run`) then `login`
  to get a fresh market.
- **Stale file sink:** `produce` writes `/tmp/livestreak-<runId>.mp4`; a leftover from a
  failed run trips "File sink output path already exists". `rm -f /tmp/livestreak-*.mp4`.
- **Reverted userOp diagnosis:** the Safe 4337 module masks inner reverts as
  `ExecutionFailed()` (`0xacfdb444`). Get the real reason with
  `cast run <txHash>` (full call trace) — that's how the createVault OutOfGas was found.

## 5. Multichain: add the Sui-localnet leg

The local stack can run **both** chains at once so the app flips EVM↔Sui by config
alone (the app imports `localnetDeployment` from `@livestreak/contracts/sui` and selects
it via `setChain('sui')` — no rebuild, no code change). `./dev.sh` boots the Sui leg by
default; set `WITH_SUI=0` for the EVM-only stack.

### Toolchain (extra)

- `sui` CLI on `PATH` (`brew install sui`; verified on 1.73.0).
- A `sui client` env named `localnet` → `http://127.0.0.1:9000`, with an active address.
  `dev-sui.sh` creates/switches it automatically (`sui client new-env --alias localnet …`).

### One command — `./dev.sh`

With `WITH_SUI=1` (default) `dev.sh` runs the EVM bring-up, then sources `dev-sui.sh`
and brings the Sui leg up, in order: kill stale `sui` → `sui start --with-faucet
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

### Sui leg on its own — `./dev-sui.sh`

`./dev-sui.sh` boots just the Sui localnet + faucet, deploys, funds the sponsor, and
blocks (Ctrl+C to stop). Useful for iterating on the Sui path without anvil/host/app.

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
  tool's own faucet poke is racy. `dev-sui.sh` pre-funds the active deployer and blocks on
  `sui client gas` before deploying — if you deploy by hand, faucet the active address first.
- **Deployer keypair:** `deploy:sui` uses the `sui client` active address' key when one is
  exportable, else falls back to the localnet dev mnemonic (localnet only — it refuses to
  sign on testnet/mainnet). The host sponsor uses that same dev mnemonic, derived at
  `m/44'/784'/0'/0'/0'` → `0x1846…25f6`.
