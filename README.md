# LiveStreak

**Watch a live stream. Take a side. Fund your prediction as the moment unfolds.**

LiveStreak brings prediction markets into the video player. A match, a debate, a creator's broadcast, or an automated data show can carry multiple YES/NO questions. Viewers stream USDC into their chosen sides over time, follow their positions while watching, and claim after the outcome is resolved.

[Open the app](https://livestreak.vercel.app) · [Agent control](cli/docs/agent-control.md) · [Host deployment](DEPLOYMENT.md)

## One stream, many questions

1. **Broadcast:** an operator captures and publishes watchable video, then registers its market.
2. **Create predictions:** a bookmaker opens and seeds vaults with a question, decision rules, funding deadline, and designated Steward.
3. **Participate:** viewers fund YES or NO, adjust their funding, and follow their live positions.
4. **Resolve:** the Steward evaluates evidence against the committed rules and publishes an explicit outcome with a reason and receipt.
5. **Claim and replay:** viewers collect eligible payouts or LVST loss rewards; completed recordings remain available when archival succeeds.

Resolution is generic. A question can use human judgment or a data adapter, according to its declared rules. The platform does not require every stream to use the same oracle.

## Independent roles, shared plumbing

Each role has its own SDK, runtime, and control surface. People or agents can drive those surfaces through the CLI and remote browser console.

| Role | Responsibility | Package |
| --- | --- | --- |
| Broadcaster | Capture video, publish media, manage the stream lifecycle | `@livestreak/observe` |
| Bookmaker | Define questions and rules, create and seed vaults | `@livestreak/bookmaker` |
| Viewer | Read markets, fund positions, collect claims | `@livestreak/options` |
| Steward | Evaluate evidence, explain decisions, submit resolution | `@livestreak/steward` |

The **Host** supplies shared services: discovery and chain indexing, video relay and recording, metadata storage, sponsored transaction endpoints, and remote session transport. Signing stays in the operator's gateway. Remote access uses scoped, revocable grants.

The wallet service uses **ZeroDev-backed sponsorship for its configured EVM network**. Sponsorship depends on the active provider and network configuration.

## Networks

LiveStreak's product scope is **Monad and Solana**: Solidity contracts for Monad's EVM and a native Solana program.

Deployment wiring is still being aligned with that scope. **This checkout does not yet contain a Monad deployment**, and the checked-in Solana default is localnet. The current frontend and Host EVM defaults also still need migrating. A network is ready for use when its deployment snapshot, Host configuration, wallet provider, and frontend agree.

## Develop

Use **Node.js 22**. Broadcasting also requires FFmpeg. Foundry is needed to build and test Solidity; the Solana toolchain is needed for program work.

From the repository root:

```sh
npm ci
npm run build:packages:ts
npm run build --workspace=@livestreak/cli
npm run build --workspace=@livestreak/host-server
```

Configure the Host's private `.env` for your database, object storage, wallet provider, and deployed contracts. Configure the frontend's `VITE_HOST_BASE_URL` to reach that Host. See [Host deployment](DEPLOYMENT.md) for the current operating setup.

Run these in separate terminals:

```sh
npm run dev --workspace=@livestreak/host-server
```

```sh
npm run dev --workspace=app
```

The default frontend address is `http://localhost:3000`; the Host listens on `http://127.0.0.1:8787`.

### Drive a role session

```sh
node cli/dist/main.js settings init --host-url http://127.0.0.1:8787
node cli/dist/main.js remote open --help
```

Initialize and unlock your operator keystore, configure the intended network in CLI settings, then open a session with the action scopes that role needs. The CLI prints a console URL and pairing credentials. An outside agent can use the same scoped interface through `@livestreak/cli/agent-client`; see the [agent control guide](cli/docs/agent-control.md).

## Repository map

| Path | Contains |
| --- | --- |
| `app/` | Video player, stream discovery, positions, remote consoles |
| `host/` | Shared APIs, chain index, media relay, archival, session transport |
| `cli/` | Operator keystore, settings, role gateway, agent client |
| `packages/observe`, `bookmaker`, `options`, `steward` | The four independent role SDKs |
| `packages/schema`, `core`, `wallet`, `host` | Shared types, runtime primitives, wallets, Host client contracts |
| `packages/contracts/chains/evm/` | Solidity contracts, ABIs, deployment tooling and snapshots |
| `packages/contracts/chains/solana/` | Native program, streaming engine, IDL and deployment tooling |
| `examples/` | Agent and integration examples |

## Checks

```sh
npm run check
npm run lint
npm test
```

Individual workspaces also expose their own checks. For contract changes, run the relevant Solidity or Solana tests in addition to the SDK checks.
