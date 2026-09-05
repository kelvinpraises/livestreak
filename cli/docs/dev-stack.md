# CLI dev-stack bring-up

Copy-pasteable steps to go from a clean checkout to a running CLI against a local stack.

## Prerequisites

- Node 20+ with pnpm
- Foundry (`anvil`, `forge`, `cast`) — https://getfoundry.sh
- A local host binary (see `host/` in this repo)

## 1. Start anvil

```sh
anvil --chain-id 31337 --block-time 1
```

Leave it running in its own terminal.

## 2. Deploy contracts

From the repo root:

```sh
pnpm --filter @livestreak/contracts evm:deploy:local
```

This writes `packages/contracts/chains/evm/deployments/localhost.json`.
Confirm the file exists and `scopes.wire.status === "completed"` before continuing.

## 3. Start the host

```sh
pnpm --filter @livestreak/host start
# or directly:
node host/dist/main.js
```

The host listens on `http://localhost:4848` by default.
Verify: `curl http://localhost:4848/health` should return `{"status":"ok"}`.

## 4. `livestreak init`

```sh
node cli/dist/main.js init \
  --deployment packages/contracts/chains/evm/deployments/localhost.json \
  --host http://localhost:4848 \
  --network testnet \
  --out livestreak.json
```

Inspect `livestreak.json` — it must contain `chain`, `host`, `options`, and `wallet.config` sections.

## 5. `livestreak login`

```sh
LIVESTREAK_PASSWORD=<your-password> node cli/dist/main.js login --config livestreak.json
```

Or interactively (TTY required):

```sh
node cli/dist/main.js login --config livestreak.json
# → Operator password: (masked prompt)
```

Output shows your AA wallet address and confirms it is cached in `livestreak.json` as `run.operator`.
The seed is derived in memory and discarded; it is never written to disk.

## 6. Fund the operator

Transfer test USDC to the AA address shown by `login`. On anvil, the mock USDC deployer
holds all initial supply:

```sh
# Example using cast — adjust USDC address and operator address from livestreak.json.
USDC=0x76bb00aa1936dd7cda6df2fa403f1439e3db456a
OPERATOR=<run.operator from livestreak.json>
cast send $USDC "transfer(address,uint256)" $OPERATOR 1000000000 \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## 7. Gated live e2e

With the stack running and a sample `.mp4` available:

```sh
LIVESTREAK_LIVE=1 \
LIVESTREAK_CONFIG=./livestreak.json \
LIVESTREAK_PASSWORD=<your-password> \
LIVESTREAK_VIDEO=./test-clip.mp4 \
  pnpm --filter @livestreak/cli test
```

The test `e2e.live.test.ts` drives the full loop:
produce → vault create → nft mint → fund → claim → stake.
