# LiveStreak

LiveStreak turns any live stream into a prediction market. Point it at a football match, an esports final, a debate, anything happening in real time, and it opens small yes/no questions you can bet on while you watch. Will there be a red card? Does this team score next? You stream USDC onto the side you believe in through floating cards laid over the video, and when the moment resolves the winners get paid. Lose and you don't walk away with nothing either, because the loss mints **$LVST**, a token that turns being wrong into a small piece of ownership.

It runs on EVM, Sui, and Solana, and the app doesn't much care which. It flips between them by config, the same interface sitting over a different deployment underneath. The video, the market metadata, and the steward's memory all live on Walrus, served through the host.

## How it works

A stream comes in and the observe pipeline captures it, processes it, and publishes it with a Walrus pointer attached. The market opens from there, and people fund the YES and NO vaults by streaming into them over time rather than placing one lump bet. When the outcome is known someone resolves it, the winners withdraw, and the losing side mints $LVST. On the sports side, anything that reduces to a stat can settle straight through TxLINE's on-chain feed; the questions that don't reduce that cleanly are the ones our own Agora layer is there to read.

```
[stream] → observe (capture → process → publish)
              ↓  market opens, Walrus pointer attached
        options (stream USDC onto YES / NO, claim)
              ↓
        steward / TxLINE (resolve)
              ↓
        $LVST (a loss becomes ownership)
```

Nobody runs the whole thing from one command. Each package (observe, options, bookmaker, steward) is its own control surface, and an operator drives them from browser tabs after opening a remote session from the CLI. The seed stays in the CLI keystore and never crosses the wire.

## Run it

You'll need Node 22+, Foundry for EVM, and the Sui CLI for the Sui leg (`brew install sui`).

```shell
./dev.sh                 # Sui localnet + Anvil + deploy + host + app
WITH_SUI=0 ./dev.sh      # EVM only
CHAIN=solana ./dev.sh    # Solana localnet
```

That brings the app up at `localhost:3000` and the host at `127.0.0.1:8787`, with each chain on its usual local port. To drive it as an operator, open a remote session and the seed stays put in the CLI:

```shell
cd cli && npm run build
node dist/main.js settings init
LIVESTREAK_PASSWORD='<password>' node dist/main.js remote open \
  --scopes 'bridge:action:*,bridge:board:read' --ttl 30m
```

Open the URL it prints and enter the pairing password.

## Where things live

The app, host, and CLI sit at the top. The real logic is in the packages: observe runs the video pipeline, options is the SDK for reading and betting on markets, bookmaker originates the vaults, and steward handles resolution and accountability. schema, core, wallet, and host hold the shared wire types and the account-abstraction wallet. Everything on-chain lives in `packages/contracts`: the Sui Move, the EVM Solidity, the Solana program, and the typed deployment snapshots.

## Deployments

Sui is live on testnet (deployed 2026-06-21); the canonical addresses are in [`chains/sui/deployments/testnet.json`](packages/contracts/chains/sui/deployments/testnet.json). EVM and Solana come up from local snapshots through `./dev.sh`. Redeploy Sui with `npm run deploy:sui -- --name testnet` from `packages/contracts`.

## Build & test

```shell
npm install && npm run build && npm run test
```

Sui Move tests run with `sui move test` in `chains/sui`, EVM with `forge test` in `chains/evm`, and the Solana engine with `cargo test` in its crate. Every chain carries the same conservation invariants and stream-lifecycle coverage.
