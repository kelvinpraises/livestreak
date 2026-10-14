# LiveStreak

**Watch a live stream. Take a side. Fund your prediction as the moment unfolds.**

LiveStreak brings YES/NO prediction markets into the video player. Viewers stream USDC into positions over time, follow their exposure while watching, and claim after resolution.

[Open the app](https://livestreak.vercel.app) · [Agent control](cli/docs/agent-control.md) · [Host deployment](DEPLOYMENT.md)

## How it works

1. A **Broadcaster** captures and publishes a stream.
2. A **Bookmaker** creates and seeds questions with committed decision rules and a funding deadline.
3. **Viewers** fund YES or NO and adjust their positions over time.
4. A **Steward** resolves outcomes using evidence and the committed rules. Winners claim payouts; eligible losing positions can mint LVST. Successfully archived streams remain available for replay.

People or agents operate each role independently through its SDK, CLI or remote console. The Host supplies discovery, chain indexing, video relay, recordings and transaction sponsorship. Signing stays in the operator's gateway. ZeroDev sponsorship has been verified on Monad testnet.

## Monad testnet deployments

**Chain ID: 10143.** The table includes protocol contracts, their implementations and wallet infrastructure. Use the **Drips proxy** and **MarketDriver proxy** for application calls. Canonical EntryPoint and Safe contracts are reused where available.

| Contract | Address | Purpose |
| --- | --- | --- |
| Protocol | [`0x709beb8be007eb2b23a55725b8bf6006962fba21`](https://testnet.monadexplorer.com/address/0x709beb8be007eb2b23a55725b8bf6006962fba21) | Protocol configuration |
| MarketRegistry | [`0x7713139dc01e0358f37e136ba62921e09b073655`](https://testnet.monadexplorer.com/address/0x7713139dc01e0358f37e136ba62921e09b073655) | Stream registry |
| Vault | [`0x60ccdf63cb3723c9083a1f0908f149ac63ea6498`](https://testnet.monadexplorer.com/address/0x60ccdf63cb3723c9083a1f0908f149ac63ea6498) | Prediction vault |
| Drips proxy | [`0xd653d50dec0338bdca006fe9dcf82574bf3aa8b2`](https://testnet.monadexplorer.com/address/0xd653d50dec0338bdca006fe9dcf82574bf3aa8b2) | Streaming payments |
| MarketDriver proxy | [`0x00bfc9aa3d06b2182c89c0941f653de0fd1f7071`](https://testnet.monadexplorer.com/address/0x00bfc9aa3d06b2182c89c0941f653de0fd1f7071) | Position management |
| VaultDriver | [`0xb290099d7356652ff4fed536d07dbf6cee7b9f9e`](https://testnet.monadexplorer.com/address/0xb290099d7356652ff4fed536d07dbf6cee7b9f9e) | Vault creation |
| StewardRegistry | [`0x934d5173b80eb403c845e34a01bcea21abf77b40`](https://testnet.monadexplorer.com/address/0x934d5173b80eb403c845e34a01bcea21abf77b40) | Outcome resolution |
| Treasury | [`0x0e76f153cf1d5bba65b86ab2c6faadb1b177d3ad`](https://testnet.monadexplorer.com/address/0x0e76f153cf1d5bba65b86ab2c6faadb1b177d3ad) | Protocol treasury |
| LVST | [`0xcb40db9b431b18b2b4f25ab2aeda67776d9e10a2`](https://testnet.monadexplorer.com/address/0xcb40db9b431b18b2b4f25ab2aeda67776d9e10a2) | Reward token |
| Test USDC | [`0x76bb00aa1936dd7cda6df2fa403f1439e3db456a`](https://testnet.monadexplorer.com/address/0x76bb00aa1936dd7cda6df2fa403f1439e3db456a) | Test collateral |
| Caller | [`0x69af9aa0e3ba6530d2f947a6e9c61f5691e8a72b`](https://testnet.monadexplorer.com/address/0x69af9aa0e3ba6530d2f947a6e9c61f5691e8a72b) | Transaction forwarding |
| DripsStreaming logic | [`0xc20641edde8cecf5a6530a3edbd7fbbffe0bf3d5`](https://testnet.monadexplorer.com/address/0xc20641edde8cecf5a6530a3edbd7fbbffe0bf3d5) | Streaming implementation |
| MarketDriver logic | [`0x381d7f48f40569069be210ca0209b19db130cf55`](https://testnet.monadexplorer.com/address/0x381d7f48f40569069be210ca0209b19db130cf55) | Position implementation |
| EntryPoint v0.7 | [`0x0000000071727De22E5E9d8BAf0edAc6f37da032`](https://testnet.monadexplorer.com/address/0x0000000071727De22E5E9d8BAf0edAc6f37da032) | Account abstraction |
| Safe singleton | [`0x41675C099F32341bf84BFc5382aF534df5C7461a`](https://testnet.monadexplorer.com/address/0x41675C099F32341bf84BFc5382aF534df5C7461a) | Wallet implementation |
| SafeProxyFactory | [`0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`](https://testnet.monadexplorer.com/address/0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67) | Wallet deployment |
| SafeModuleSetup | [`0x71ebd4303657bf41f4b730f06536fd5b580dbdca`](https://testnet.monadexplorer.com/address/0x71ebd4303657bf41f4b730f06536fd5b580dbdca) | Module initialization |
| Safe4337Module | [`0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226`](https://testnet.monadexplorer.com/address/0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226) | Sponsored wallet execution |
| MultiSend | [`0x0a1e9f157d53f156a4dc0479fa2af500ba7d5f87`](https://testnet.monadexplorer.com/address/0x0a1e9f157d53f156a4dc0479fa2af500ba7d5f87) | Transaction batching |
| MultiSendCallOnly | [`0x90fe1a52c5e6d204e1ec36c48dbe79cbc209d3aa`](https://testnet.monadexplorer.com/address/0x90fe1a52c5e6d204e1ec36c48dbe79cbc209d3aa) | Call batching |
| CompatibilityFallbackHandler | [`0x9dbfb7147d46e23d6db4ebedd41c22005d376a0b`](https://testnet.monadexplorer.com/address/0x9dbfb7147d46e23d6db4ebedd41c22005d376a0b) | Wallet compatibility |
| SignMessageLib | [`0x030dcedf7dcb4238db145e4bc3d8707c90c317eb`](https://testnet.monadexplorer.com/address/0x030dcedf7dcb4238db145e4bc3d8707c90c317eb) | Message signing |
| CreateCall | [`0x9c25750c3f274facf6eeec33d5d1e0bf9b6a3da3`](https://testnet.monadexplorer.com/address/0x9c25750c3f274facf6eeec33d5d1e0bf9b6a3da3) | Contract creation |
| SimulateTxAccessor | [`0x06041007e4f2e33aa5c42f4cb2a062bb8dbd398c`](https://testnet.monadexplorer.com/address/0x06041007e4f2e33aa5c42f4cb2a062bb8dbd398c) | Transaction simulation |

## Run

Use **Node.js 22** and **FFmpeg** for broadcasting. Foundry is needed when rebuilding Solidity contracts.

```sh
npm ci
npm run build:packages:ts
npm run build --workspace=@livestreak/cli
```

Configure the root `.env` using [the Host example](host/.env.example), and set `VITE_HOST_BASE_URL` in `app/.env.local` to your Host URL. Run the Host and app in separate terminals:

```sh
npm run dev --workspace=@livestreak/host-server
```

```sh
npm run dev --workspace=app
```

The app opens at `http://localhost:3000`; the Host defaults to `http://127.0.0.1:8787`. See the [agent guide](cli/docs/agent-control.md) for role sessions and [deployment guide](DEPLOYMENT.md) for public hosting.
