# observe — end-to-end flow map

> Per HARDENING-AGENT step 1 (MAP). This traces every flow observe touches, **stage by stage**:
> the ideal path, what the **caller injects**, and the edge cases at each stage. Edges observe does
> not yet handle are marked **UNHANDLED**. Grounded by reading actual src (not TODO claims) on
> 2026-06-17; peer-verified interfaces cited with file paths.
>
> Companion docs: [architecture.md](./architecture.md) (runtime model), [TODO.md](./TODO.md) (work list).

## 0. Where observe sits

LiveStreak: **the video stream IS the market container.** A market is created when an observer's
stream starts; vaults (binary YES/NO pools) are created under that `marketId`; users participate;
stewards police. Observe owns the **video stream + control plane**. It does **not** create vaults,
hold funds, judge outcomes, or sign chain writes.

```text
observe run starts  ──▶  host session (endpoints + signed manifest)  ──▶  registerMarket (AA UserOp at edge)
        │                                                                          │
        └──────────────── marketId reconciled back onto the run ◀──────────────────┘
                                     │
            bookmaker watches stream for marketId ──▶ creates/joins vaults (AA) ──▶ options/steward
```

The composition root that wires this is the **edge** (`cli/`, future gateway, or `app/`). Today
`cli/src/*` is **empty scaffolding (0 bytes)** and its TODO is explicitly blocked on "observe
market-registration edge documented end-to-end" — i.e. on this file.

## 1. Peer-verified interfaces (read, not assumed)

| Thing | Where | Shape that matters |
| --- | --- | --- |
| observe run identity | `run/config/parse.ts:19`, Board `system:run.readonly.runId` | `runId: string` (only identity observe has) |
| observe public runtime | `run/runtime.ts` | `prepareRun/startRun/readBoard/readPanel/callFunction/getArtifact/awaitRun/stopRun` keyed by `runId` |
| capture injection seam | `run/kernel.ts` `ObserveRunKernelOptions.captureDriver/sinkDriver` | drivers are **injected**; kernel resolves built-ins or injected |
| sinks today | `pipeline/publish/sinks/file` | **file export only**. `local/` + `simulcast/` READMEs say "Planned … not implemented" |
| output vocab | `@livestreak/schema` session.ts:3 | `OutputMode = "file"|"local"|"simulcast"` |
| AA wallet config (injected) | `@livestreak/schema` wallet.ts | `WalletInit{ seedSource, config: EvmWalletInitConfig{ chainId, provider(rpc), bundlerUrl, paymasterUrl?, isSponsored, entryPointAddress, safe4337ModuleAddress, contractNetworks, … } }` — "every field CALLER-INJECTED; never hardcode" |
| host session | `@livestreak/host` session.ts | `HostCreateSessionRequest{ contentId, observer, sessionId, outputMode, … }` → `HostSessionResult{ summary, draft{ sessionId, endpoints[], manifestDraft: EndpointManifest, policy } }` |
| signed manifest | `@livestreak/host` manifest.ts | `EndpointManifest{ manifestId, sessionId, observer, contentId, hostId, endpoints[]{kind: watch\|webrtc\|state\|telemetry\|archive\|control, url, expiresAtMs}, hostPolicyStatus, cacheReceiptRefs[], expiresAtMs, signature }` |
| host AA infra | `@livestreak/host` aa.ts | bundler proxy `{host}/aa/bundler/{chain}`, paymaster proxy, `AaSponsorshipMode = none\|dev_open\|tenant_quota\|paymaster_signed` |
| market write | `@livestreak/contracts` `MarketRegistry.sol:37` | `registerMarket(string title, bytes32 streamId) → bytes32 marketId`; sequential ids; **no streamId dup guard** |

**Hard fact:** grep across `observe/src` finds **zero** of `observeRunId`, `streamId`, `marketId`,
`manifestUri`, `subjectRef`, watch/webrtc, `evidenceRef`, `WalletInit`, `registerMarket`. Observe
has **no surface** to emit a registration intent, ingest a host manifest, or receive a marketId.

## 2. What the caller (edge / composition root) injects

Observe stays a pure Effect media-runtime library. Everything chain- or secret-bearing is injected
at the edge and **never baked** into observe:

```text
- capture adapter      (browser Playwright/CDP page, or ffmpeg) — already injected via kernel options
- sink driver(s)       (file today; live/simulcast = host output, NOT built)
- host session client   to call host.createSession and obtain endpoints + signed manifest
- WalletInit            (@livestreak/schema) — AA: seed source + chainId/bundler/paymaster/entryPoint/contractNetworks
- streamId derivation    runId → bytes32 (owned by contracts; see inbox request)
- market title + observer identity (smart-account address)
- ObserveRunKernelOptions.market registration group (WalletInit + seed + registry + deriveStreamId + title)
```

## 3. Stage-by-stage flow + edge cases

Legend: ✅ handled in observe today · ⚠️ partial · ❌ **UNHANDLED**

### Stage A — Run lifecycle (prepare → start → running)
- Ideal: edge builds run config, injects capture/sink, `prepareRun → startRun`; worker reaches `running`. ✅
- Caller injects: capture adapter, sink driver, kernel options.
- Edges: bad config rejected (`parse.ts`) ✅ · capture health failure fails worker ✅ · stop/interrupt timeout ✅ · **not-deployed/out-of-scope here**.

### Stage B — Stream becomes a *live, watchable* endpoint
- Ideal: a live run exposes a **watch/WebRTC URL** that viewers + bookmaker can consume.
- Reality: observe has **only a file-export sink**. There is no live/`local`/`simulcast` output sink, so a run produces an MP4 artifact, **not a live endpoint**. ❌ **UNHANDLED** — a market needs a live stream; file export is not a market-grade endpoint.
- Edges: ❌ no live sink → no `endpoints[].url` to register · ❌ output-mode vocab mismatch (`simulcast` vs host `forwarder`, see CONFLICT inbox) · overflow (long stream) untested for live.

### Stage C — Host session (endpoints + signed manifest)
- Ideal: edge calls `host.createSession({ contentId, observer, sessionId, outputMode })`; host returns `endpoints[]` + signed `EndpointManifest` + `policy`. The live sink (Stage B) targets the host-forwarded endpoint.
- Caller injects: host session client + descriptor.
- Reality: observe makes **no** host call and has **no** field to (a) supply `contentId`/`observer`/`outputMode` from a run, or (b) ingest the returned manifest refs. ❌ **UNHANDLED**.
- Mapping questions (open): `sessionId` ↔ `runId`? `contentId` ↔ ? `observer` ↔ smart-account address?
- Edges: ❌ policy rejects (`hostPolicyStatus`, `allowWarnings`) · ❌ manifest **expiry** mid-stream (`expiresAtMs`) → needs re-issue/rotation (host `key_rotation`) · ❌ host unreachable/timeout · partial (session created, stream never goes live → orphan session).

### Stage D — Market registration on-chain (AA UserOp, at the edge)
- Ideal: edge derives `streamId = f(runId/contentId)`, builds `registerMarket(title, streamId)` as an **ERC-4337 UserOperation** from injected `WalletInit` (Safe 4337 smart account), **sponsored** by host paymaster (`paymasterUrl`), **submitted** via host bundler (`bundlerUrl`) → `marketId`.
- Caller injects: `WalletInit` (seed at runtime), streamId derivation, title.
- Reality: observe emits **no** registration intent and has **no** coordinator port; the entire write is unbuilt (cli empty). ❌ **UNHANDLED**.
- Edges (the AA failure surface — all ❌ in observe today):
  - **not-deployed**: `MarketRegistry` absent on selected chain → revert.
  - **reverted**: empty title reverts (`MarketRegistry.sol:38`); generic revert.
  - **insolvent/depleted**: paymaster sponsorship exhausted (`tenant_quota`) or `isSponsored=false` self-pay with no gas.
  - **unauthorized**: host policy / sponsorship denies; wrong `observer` identity.
  - **race/replay**: run restart/resume re-fires registration → **duplicate market** (contracts has NO `streamId` dup guard — sequential `marketId` means a second call silently makes a *second* market for the same stream). Registration MUST be **idempotent per runId**.
  - **out-of-order**: bookmaker/host try to index before `marketId` exists → must gate on marketId.
  - **timeout/pending**: bundler slow / UserOp stuck → registration pending; must **not block the media worker**.

### Stage E — marketId reconciliation
- Ideal: `marketId` (+ status/reason) flows back onto the run read model; observe projects market lifecycle `none → pending → registered(marketId) → failed(reason)` so host/bookmaker key off `marketId`. Decoupled from media lifecycle.
- Reality: ❌ **UNHANDLED** — no `marketId` field, no market-lifecycle channel.
- Edges: ❌ marketId arrives after stop (late) · ❌ failed registration but stream keeps running (market-less stream) · replay (two marketIds for one run).

### Stage F — Downstream (other packages, observe only provides marketId + endpoints)
- bookmaker watches the stream for `marketId` → creates/joins vaults via VaultFactory (also AA UserOps); options handles user participation; steward polices. Not observe's code, but observe is the **source of `marketId` + live endpoints** they depend on.

### Stage G — Stream end → market close / settlement ❌ **MISSING STAGE**
- Both adversarial reviewers found this independently: the flow stops at "register"; there is **no close/settle path**. `MarketRegistry.sol` exposes only `registerMarket`/`addVault`/reads — **no `closeMarket`/`settleMarket`/`resolve`**. When an observe stream **stops** (Stage A stop, EOS, or failure), nothing closes the market or signals vaults to settle.
- Open questions (cross-package, likely steward/contracts, but observe is the stream-end signal source): who triggers settlement (stream-end? steward? oracle?), what marks a market closed, how do vaults drain. Observe at minimum must surface a **trustworthy stream-end fact** keyed to `marketId` so the resolver can act. ❌ no such signal today.

## 3a. Adversarial cross-check additions (HARDENING-AGENT step 3 — verified)

Devil's-advocate pass (sonnet + haiku vs. this map; opus = my own pass). Findings folded in below
are **peer-verified against source**, not taken on the reviewer's word:

- **P3 caller-bound marketId** — `MarketRegistry.computeMarketId(observer, streamId)` is pure; observe computes it locally before send. No receipt event decode. Inclusion confirmed via UserOp receipt `success` only.
- **Sponsorship is a `VerifyingPaymaster`, not free gas** — `LiveStreakPaymaster.sol:12` (`is VerifyingPaymaster`, `_verifyingSigner`). The UserOp needs a host-signed paymaster approval with `validUntil/validAfter` (`host/aa.ts:63-64`, both optional). New AA edges: signer offline/refuses, approval **expires before the UserOp lands**, sponsorship mode `none`/`tenant_quota` depleted → UserOp fails. Observe's `pending` state must tolerate sponsorship-side failures, not just chain reverts.
- **The host manifest is already SIGNED, and observe has no slot for it** — `EndpointManifest.signature` is a required `NonEmptyString` (`host/manifest.ts:36`); `HostSessionDraft.manifestDraft` (`host/session.ts:42`) ships signed despite the "draft" name. Meanwhile observe's `ObserveRun.manifest` is a **`PublishManifest`** (internal passthrough, `run/run.ts:29`) — a **name collision** and an entirely different shape. There is **no field on `ObserveRun`/`ObserveRunConfig`** to carry a host session id, manifest id, or endpoint url. Manifest **rotation** (expiry mid-stream) produces a new signed `manifestId` with no carrier back to observe.
- **`sessionId` is a required INPUT to `createSession`** — `host/session.ts:16` (`sessionId: NonEmptyString`), supplied by the caller *before* the call, not returned. So Stage C's "sessionId ↔ runId" is a **blocking precondition**, not an open afterthought: the edge cannot call `createSession` until it's resolved.
- (downstream note) **`VaultFactory` uses one shared `Vault` instance** (`VaultFactory.sol`), not per-market deploys — market isolation is logical, not contract-level. Context for bookmaker/options; not observe's concern.

The cross-check **confirmed** (with file:line) every gap already in §3/§5: no `marketId` on the Board
(`board/model.ts` cells carry only `runId`/`prepared`), kernel options expose only
`captureDriver`/`sinkDriver` (`kernel.ts`), no coordinator port, no idempotency mechanism.

## 4. What AA means for observe (the crisp boundary)

```text
Observe imports @livestreak/wallet and @livestreak/contracts ONLY under src/market/chains/**.
Given injected WalletInit + runtime seed + MarketRegistry address + deriveStreamId + title,
observe constructs the AA account (createWalletManager), computes marketId locally as
keccak256(abi.encode(observer, streamId)) — byte-identical to MarketRegistry.computeMarketId (P3) —
sends registerMarket as a UserOp, confirms inclusion via getUserOperationReceipt success only
(no event decode), and projects a `market` board cell lifecycle:
none → pending → registered(marketId) → failed(reason).

Slice 1's receipt-decode + sender/streamId verify were designed out: P3 makes marketId
caller-bound and unique, so decoding MarketRegistered and self-comparing streamId/sender is redundant.

Observe NEVER: bakes seed/bundler/paymaster/rpc/entryPoint/chain/addresses, blocks a worker
turn on the chain write, or imports wallet/viem/contracts outside market/chains/**.

ObserveRunKernelOptions.market (optional):
  - registration: WalletInit (schema-validated), seed, marketRegistryAddress, title, deriveStreamId
  - registrar?: injected override for tests (mirrors captureDriver override)
When absent, the `market` cell stays `none` and no chain code runs.

Registration runs as a forked fiber in the run scope at start — idempotent per runId, non-blocking
the media worker. streamId derivation is injected — contracts owns the canonical formula (inbox still open).
```

## 5. Gap summary (what current impl does NOT satisfy)

| Gap | Stage | Severity |
| --- | --- | --- |
| No live output sink (only file export) — no watchable endpoint to register | B | blocks live markets |
| `simulcast` (observe/schema) ≠ `forwarder` (host) output vocab, not a shared enum | B/C | blocks host output wiring (CONFLICT filed) |
| No host-session handoff (contentId/observer/outputMode out; manifest refs in) | C | blocks manifest/endpoints |
| No registration-intent read-model; no `streamId` derivation | D | blocks registerMarket |
| No injected MarketRegistrationCoordinator port (AA UserOp seam) | D | blocks the chain write |
| Registration not idempotent per runId → duplicate-market risk | D | correctness |
| No `marketId` + market-lifecycle channel on the run read model | E | blocks bookmaker/host |
| `pending` must tolerate sponsorship-side failure (VerifyingPaymaster approval expiry/refusal) | D | AA correctness |
| `ObserveRun.manifest` (PublishManifest) name-collides host `EndpointManifest`; no slot to carry host session/manifest refs | C | blocks manifest ingest |
| `sessionId↔runId` is a blocking precondition for `createSession`, not an open question | C | blocks session |
| **Missing stage: stream-end → market close / settlement** (no close/settle in contracts; observe gives no stream-end signal keyed to marketId) | G | blocks resolution |
| Manifest expiry / rotation mid-stream unhandled (signed manifest, new manifestId, no carrier) | C | long-run correctness |

## 6. Open cross-package questions (inbox)

- contracts — `context/temp-convo/contracts/inbox/from-observe__streamid-derivation.md`: `runId→streamId` formula + streamId dup guard.
- host — `context/temp-convo/host/inbox/from-observe__endpoint-manifest-seam.md`: who assembles/signs the manifest; raw-facts shape; sessionId/contentId mapping.
- host — `context/temp-convo/host/inbox/from-observe__CONFLICT-output-mode.md`: converge `simulcast`/`forwarder`.

> Adversarial cross-check (HARDENING-AGENT step 3) and the implementation proposal follow in
> [TODO.md](./TODO.md) and `context/temp-convo/replies/observe.md`. **No implementation until the user approves.**
