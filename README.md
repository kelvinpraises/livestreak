# LiveStreak

Live video prediction markets, settled on-chain. Any live stream — football, esports, debates —
becomes a surface for real-time binary options: CV agents watch the stream, generate prediction
options, and stake their own capital; viewers stream USDC onto YES/NO sides via floating
"Niko-Niko" cards over the video. The loss-to-ownership token is **$LVST**.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/observe` | Video observe pipeline (capture → process → publish), run lifecycle, control bus, bridge. **Effect** runtime. |
| `packages/contracts` | Solidity (Foundry) + wagmi-generated ABIs: market/vault, bonding-curve Board, streamed funding (mined Drips), resolution, `$LVST` token, steward registry, AA. |
| `packages/options` | Browser-safe consumer SDK: read markets/vaults/positions/funding, runtime, write transport (fund/claim). Plain TS. |
| `packages/bookmaker` | Vault origination under a market: detect → draft → similarity → create/join/skip. Plain TS. |
| `packages/steward` | Accountability workflow: facts → rules → decisions → action plans → panel, + injected runtime. Plain TS. |
| `packages/host` + `host/` | Shared host types + the server edge: sessions, cache, similarity, forum, AA bundler/paymaster. Effect-Schema validation. |
| `packages/schema` | Shared Effect-Schema types (session, time, wallet-init). |
| `packages/wallet` | Vendored `wdk-4337` ERC-4337 Safe wallet SDK. |
| `cli` | CLI / gateway: preferences, host selection, AA execution, package commands (early). |
| `context/quary/` | Archived legacy stacks, drafts, and reference material (not in workspaces). |
| `context/temp-convo/` | Agent coordination: prompts, replies, inboxes, `HARDENING-AGENT.md`, `GENERAL-AGENT.md`. |

Each package's `docs/architecture.md` is its design law, `docs/TODO.md` its sequencing + blockers,
and `docs/flow.md` its end-to-end flow + edge map. When this README and a local doc disagree on
package internals, the local doc wins.

## How it's organized

- **Two code models, chosen by fit.** `observe` uses the Effect runtime (concurrent media / IO /
  lifecycle); `options` / `bookmaker` / `steward` / `host-server` / `cli` are plain TS + Promises +
  injected transports; `schema` + host-types use Effect Schema as a validation library only.
  `contracts` is Solidity + wagmi-generated ABIs (no handwritten TS read/write boundary).
- **Edge config is injected, never baked.** Wallet seed, bundler/paymaster URLs, chain, and the
  Safe/AA addresses are supplied by the caller (app/CLI), declared via `WalletInitConfig` in
  `@livestreak/schema`. Vanilla packages consume schema types with `import type` (zero Effect dep).
- **Clean domain folders, explicit ownership.** No junk-drawer folders; `src/index.ts` is re-export
  only; browser-safe packages keep Node-only APIs out of `src`.

## Build & test

- TS package: `npm run check && npm run build && npm test` in that package.
- Contracts: `forge build && forge test`; regenerate ABIs with `npm run gen`.

## Agents & coordination

Work is driven by per-package agents and tracked in files, not chat.

- **Per-package hardening agents** run the standing prompt `context/temp-convo/HARDENING-AGENT.md` (one per
  package): map flows → find edges → cross-model devil's-advocate → propose → wait for the user →
  implement + self-verify. They edit only their own package.
- **The general agent** (`context/temp-convo/GENERAL-AGENT.md`) owns repo-wide cleanup and renames.
- **Coordination is file-based** under `context/temp-convo/`: `prompts/<pkg>.md`, `replies/<pkg>.md`, and a
  per-package `<pkg>/inbox/` for append-only cross-package dependency requests.
