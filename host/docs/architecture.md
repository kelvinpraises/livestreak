# Host runtime

Host fills in infrastructure that SDK users should not have to operate: chain indexing,
media ingest and recordings, content storage, remote gateway sessions, and sponsorship.
`packages/host` owns the shared wire types; `host` owns their server implementation.

## Source layout

| Path | Responsibility |
| --- | --- |
| `main.ts`, `server.ts`, `deps.ts` | Start transports, mount routes, construct shared state |
| `config/` | Environment, network and explicit deployment inputs |
| `features/aa/` | Sponsorship HTTP routes and one provider implementation per chain |
| `features/catalog/` | All discovery HTTP routes, chain readers, indexer, scheduler and page projections |
| `features/content/` | Blob/VOD HTTP routes, uploads, mandates and resolution records |
| `features/live/` | HTTP signaling, live WebSocket transport and live-byte state |
| `features/remote/` | HTTP/WS console transport, authentication, grants, sessions and relay |
| `features/media/` | Policy/session HTTP routes, manifests and evidence |
| `features/recordings/` | Recording HTTP routes, lifecycle and MP4 verification |
| `features/discovery/` | Similarity HTTP routes and index |
| `features/forum/`, `features/memory/`, `features/descriptor/` | Complete small HTTP features; no separate service hop |
| `http/` | Shared response/error helpers, limits, CORS and headers |
| `database/` | Kysely connection, schema and the single baseline migration |
| `storage/` | External S3-compatible object store |

A feature owns its HTTP workflow, state and any scheduler or WebSocket transport. There are
no parallel `api`, `services` or `infrastructure` trees to trace. `database/` and `storage/`
remain shared because multiple features use those external resources. The runtime baseline is shared with tests; source filenames alone do not establish that a module is unused.

There is no repository layer, embedded bundler, Kora process, Walrus client, or LiveKit stub.
All discovery pages use the same database projection. The squashed baseline adopts known earlier migration records transactionally, preserving existing data.

## Infrastructure boundaries

EVM bundler calls go to the configured `bundlerUrl`; optional hosted paymaster calls go to
`paymasterUrl`. The Host preserves provider gas estimates. Host does not hold an EVM paymaster signing key.
Public sponsorship requires Host authorization. Provider gas policy and budget are separate
from Host authentication.

Solana currently uses the Host's native fee-payer key behind its existing Kora-compatible
wire protocol. That protocol remains because existing SDK wallets call it; it does not run
a Kora server. ZeroDev's Solana sponsorship protocol is different and is not yet wired here.
Sui uses a funded native sponsor and the existing gas-coin reservation pool.

Media policy sessions are metadata, not live broadcasts. Their manifests contain no playback
endpoints until a real provider supplies them. Simulcast is unavailable; a key cannot enable an
unimplemented provider. Live video uses `/live` HTTP/WS paths. Archived playback uses `/recordings`.
Manifests and cache receipts remain explicitly unsigned, and do not prove storage by themselves.

## Development and verification

Public testnets are the intended integration environment. The root `dev.sh` and app still
contain local-chain assumptions; they have not yet been migrated. Host cleanup alone is not
proof of a complete public-testnet journey.

Configure explicit deployment paths and separate database/storage resources before using
public testnets. Do not point testnet readers at local deployment snapshots. The database uses Kysely over remote libSQL/Turso. Configure `TURSO_DATABASE_URL`
(or `DATABASE_URL`) and `TURSO_AUTH_TOKEN`; there is no local file default or replica.

Use Node 22 for the workspace and test-only native SQLite binding:

```sh
npm run check --workspace=host
npm test --workspace=host
npm run build --workspace=host
```

See [catalog-index.md](./catalog-index.md), [storage.md](./storage.md), and
[remote-console.md](./remote-console.md). Old build plans and local-stack instructions were
archived under `context/archive/host-before-testnet-cleanup-2026-10-04`.

## State ownership

`createHostRouteDeps` is the single constructor for mutable Host state. Async boot checks storage,
prepares sponsors and records migrations before starting catalog scheduling. Tests and production
use the same live ring and direct-announcement callback for indexed live status. Routes declare
only the dependencies they read. Session draft and summary share one keyed record; callers cannot
mutate stored manifests by holding an input reference. Catalog projection resets and the cached
process-wide AA deployment snapshot were removed.

AA has one configuration owner (`config/aa.ts`, with explicit snapshots in `config/deployment.ts`) and one implementation per chain (`evm.ts`,
`sui.ts`, `solana.ts`). Revert decoding stays separate because it is a self-contained codec.
The baseline migration and separate WS transports remain explicit boundaries.

## Active target: Arbitrum Sepolia

Arbitrum Sepolia is chain **421614**, RPC `https://sepolia-rollup.arbitrum.io/rpc`.
The ZeroDev example uses `ZERODEV_ARBITRUM_SEPOLIA_RPC_URL` for bundling and sponsorship.
The supplied project returned `eth_chainId = 0x66eee`; sponsored execution is not yet proven.

The demo uses our own permissionless six-decimal MockUSDC again. Its token address comes
from the protocol deployment snapshot for this network; no Paxos token or supply-control
address is used. Browser mint requests use the connected wallet and confirmed transactions.

The app imports `arbitrumSepoliaDeployment` from `@livestreak/contracts/evm`. Host and CLI
load its JSON through the package Node loader; Host can override the snapshot path with
`LIVESTREAK_DEPLOY_SNAPSHOT`. CLI checks deployment/CAIP-2 agreement before using addresses.
The Arbitrum deployment is recorded in
`packages/contracts/chains/evm/deployments/arbitrum-sepolia.json`. Our test USDC is
`0x76bb00aa1936dd7cda6df2fa403f1439e3db456a`. All four scopes (AA, streaming, protocol,
wire) completed; the retired paymaster is omitted. Do not reuse the bundled localhost addresses.
This deployment does not establish hosted sponsorship or the complete browser funding journey.
Sui is paused in the app picker, saved-selection restoration and direct chain selection, while its
implementation and tests remain. Solana's existing integration is unchanged.

Mandates and resolution records use the same Kysely connection as indexing, memory and forum.
Boot applies versioned migrations before scheduling indexing. Only isolated unit tests can
request an in-memory database; persistent SQLite is a test fixture, not a runtime backend.
