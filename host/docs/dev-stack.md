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
