# @livestreak/bookmaker Architecture

This document is for the developer who arrives with no conversation history and needs to move. It explains the architecture we want, why the folders exist, what should not be built, and how a bookmaker agent turns live observation context into explicit vault creation decisions.

The short version: **`packages/bookmaker` is the market-making workflow package with an in-package multichain executor**. It does **not** trade or own user positions. It does **not** create markets. **Observe registers the market** when a video stream starts; bookmaker watches that stream and **creates or joins vaults under an existing `marketId`**. Host suggests similar vaults inside the market via `POST /discovery/find`; bookmaker executes `VaultDriver.createVault` via `chains/`; options handles user participation.

## The law (five packages)

```text
Observer creates the Market.
A live/replay video stream is the market container.
Bookmaker watches that stream and creates vaults under that market.
Options lets users stream into vaults.
Stewards police vaults, observers, bookmakers, and other stewards.
Host indexes/discovers/relays — it does not decide market truth.
Contracts store explicit final actions, not fuzzy similarity logic.
```

Bookmaker is **not** the truth engine. It is a **vault origination workflow** over observation + host discovery + contract write intents.

## Vocabulary

| Correct term | Meaning |
| --- | --- |
| `Market` | Container tied to an observer video stream / observe run. Created when observe registers the stream — **not** by bookmaker. |
| `Vault` | Binary YES/NO prediction pool under one `marketId`. Bookmaker creates or joins these. |
| `Detection` | Strategy output: a possible vault opportunity from observations. |
| `BookmakerMarketContext` | Read-only context for an **existing** observe-registered market. Bookmaker does not author market creation in v0. |
| `VaultDraft` | Proposed vault question, timing, resolution source, optional creator stake/side. |
| `SimilarityResult` | Host-returned candidate vaults **scoped to `marketId`**. |
| `BookmakerDecision` | Explicit action: create vault, join vault, or refuse/skip. |
| `CreateVaultIntent` | Chain-agnostic bonded seed write: marketId, question, side, stake, seedRate. |
| `BookmakerRuntime` | In-memory state: watch → detect → draft → similarity → decide → execute. |
| `BookmakerPanel` | Projected status under `bridge/panel/`. |

Do not use these as bookmaker architecture terms:

| Old / wrong term | Replacement |
| --- | --- |
| Bookmaker creates market | Observer/observe run registers market; bookmaker creates **vaults** |
| Topic collapse / auto-merge | Host vault similarity **inside `marketId`**; explicit join/create choice |
| `MarketDraft` | `BookmakerMarketContext` — market creation belongs to observe/contracts edge orchestration |
| `CreateVaultParams` as center | `VaultDraft` + `BookmakerDecision` + `WritePlan` |
| Steward approval gate (v0) | Steward **signals** risk; no creation veto in v0 |
| Bookmaker streams USDC | `options` funding streams |
| Bookmaker resolves vaults | `steward` + contracts resolution paths |
| Global fuzzy market grouping | Markets grouped by observer stream identity only |

## What Bookmaker Is

```text
packages/bookmaker = vault origination workflow
```

### Owns

```text
watch direct WebRTC/watch URL, observation channel, and manifest context for a marketId
detect vault opportunities (strategy/detectors)
build VaultDraft from detections
query host for similar vaults under marketId
choose join existing vault | create new vault | skip
execute createVault via chains/ (vaultDriverAbi + wallet inside package)
bookmaker runtime state, events, bridge panel projection
resolution *inputs* attached to vault draft (source refs, window) — not final truth
```

### Does not own

```text
market registration                    -> observe (+ contracts write at stream start)
user streaming into vaults             -> options
similarity index storage               -> host
truth / finality / veto                -> steward + contracts
TEE steward execution                  -> steward + host runtime
wallet secrets                         -> CLI / app / gateway
video capture / observe pipeline       -> observe
on-chain ABI authority                 -> @livestreak/contracts
```

| Concern | Owner |
| --- | --- |
| Market exists because stream started | **observe** registers `marketId` |
| Vault under market | **bookmaker** |
| User YES/NO funding | **options** |
| Hot / dispute / resolution execution | **steward** |
| Similar vault suggestions | **host** |
| Explicit chain state | **contracts** |

## Corrected E2E flow

```text
1. Observer starts streaming
   Observe run produces WebRTC/watch endpoint, endpoint manifest, cache/evidence refs.

2. Observer registers Market (not bookmaker)
   marketId references observeRunId, manifest URI, subjectRef, observer address.
   Contract event: MarketRegistered.
   Host indexes market + manifest metadata.

3. Bookmaker watches the stream
   Consumes direct WebRTC/watch URL, observation channel, and manifest context for marketId.
   Bookmaker did not create the market.

4. Bookmaker detects an opportunity
   Example: "Will Team A score in the next 10 minutes?"

5. Bookmaker builds VaultDraft
   question, outcomeKind binary, sides yes/no, expiry, resolutionSource,
   rulesetId, optional creatorStake/creatorSide, evidence refs from observe.

6. Bookmaker queries Host (scoped to marketId)
   findSimilar({ marketId, vaultDraft }) -> SimilarityResult
   No global cross-video merge.

7. Bookmaker chooses explicit action
   A. join existing vault (if policy allows)
   B. create new vault under marketId
   C. skip / refuse (duplicate risk, low confidence, steward warning)

8. Bookmaker optionally reads steward signals (not permission)
   rogue bookmaker flags, category warnings, evidence ruleset mismatch.
   v0: signals inform skip/refuse; they do not block on-chain.

9. Bookmaker builds WritePlan
   @livestreak/contracts encoders:
     createVault(marketId, ...)
     or joinVaultAsCreator(vaultId, ...) if supported

10. Execute via AA
    wallet -> host bundler POST /aa/bundler/:chain -> EntryPoint -> contracts

11. Contracts emit VaultCreated / VaultJoined

12. Host indexes new vault under marketId

13. Options surfaces vault; users stream YES/NO

14. Stewards monitor post-creation
    duplicate/scam vault, bad evidence, bad resolution, rogue bookmaker/steward
```

## Market creation rules (v0)

Markets are **observer-originated**. Bookmaker creation rules apply to **vaults only**.

### Vault creation (v0)

| Approach | Verdict |
| --- | --- |
| Permissionless vault create under valid market if config valid | **Best v0** |
| Allowlisted bookmakers only | Later maybe |
| Steward-approved vault create | No for v0 — too slow for live |
| On-chain similarity / duplicate rules | No — host suggests; contracts store explicit choice |

```text
A bookmaker can create a vault under marketId if:
  marketId exists and references active observe stream
  vault draft config is valid
  question is well-formed
  expiry / resolution window is valid
  optional creator stake minimum is met
  explicit action chosen (create | join) — not auto-merge
```

No vault merging. No auto-collapse. **Collapse means "pick the canonical vault before writing,"** not merge liquidity on-chain.

## Similarity model (vault-scoped)

```text
No fuzzy market grouping in v0.

Markets are grouped by observer stream identity:
  marketId
  observeRunId
  endpointManifestUri
  subjectRef (if available)

Similarity applies INSIDE one market only:
  "Under this video, is there already a similar vault?"
    yes -> join or skip
    no  -> create new vault
```

### Host suggestion flow (not on-chain magic)

```text
Bookmaker holds VaultDraft
  -> Host.findSimilar({ marketId, vaultDraft })
  -> Host returns scored candidates
  -> Bookmaker policy chooses join | create | skip
  -> Contracts write explicit action
```

Stewards **annotate** (hot, duplicate, suspicious) — they are not the hidden grouping engine.

### Deterministic keys (v0)

```text
marketKey   = observer-registered (observeRunId + manifest hash + subjectRef)
vaultKey    = normalized question + resolution window + resolution source + marketId
```

Host similarity may use fuzzy scoring; **contracts only see explicit vaultId/marketId writes**.

## Draft and decision shapes

### Market context (read-only for bookmaker)

Bookmaker receives market context from observe/host/contracts — it does not create a market draft for registration in v0.

```ts
export interface BookmakerMarketContext {
  readonly marketId: string;
  readonly observeRunId: string;
  readonly observer: string;
  readonly endpointManifestUri?: string;
  readonly subjectRef?: string;       // match / fixture / event id
  readonly category?: string;         // football, esports, macro, ...
  readonly title?: string;
  readonly rulesetId?: string;
  readonly startedAtMs?: number;
  readonly evidenceRefs?: readonly string[];
}
```

### Watch source

Bookmaker watches an existing market stream. It should be able to run from direct stream links without owning observe runtime internals.

```ts
export interface BookmakerWatchSource {
  readonly marketId: string;
  readonly watchUrl?: string;              // human/player URL when available
  readonly webrtcUrl?: string;             // WHEP/WebRTC playback endpoint when available
  readonly observationEndpoint?: string;   // structured event/data channel
  readonly endpointManifestUri?: string;
  readonly cacheReceiptRefs?: readonly string[];
}
```

`BookmakerWatchSource` is input context. It is not a host session, not an observe run handle, and not durable state owned by bookmaker.

### Vault draft

```ts
export interface VaultDraft {
  readonly marketId: string;
  readonly question: string;
  readonly outcomeKind: "binary";
  readonly sides: readonly ["yes", "no"];
  readonly vaultType?: "momentum" | "player" | "threshold" | "timing" | "swing" | string;
  readonly resolutionSource: string;    // manifest ref, ruleset id, steward ruleset
  readonly resolutionWindow: {
    readonly opensAtMs?: number;
    readonly expiresAtMs: number;
  };
  readonly fundingToken: string;        // USDC address
  readonly creatorSide?: "yes" | "no";
  readonly creatorStake?: bigint;
  readonly evidenceRefs?: readonly string[];
  readonly observationRef?: string;
}
```

### Detection (strategy output)

```ts
export interface Detection {
  readonly detectorId: string;
  readonly confidence: number;          // 0..1
  readonly question: string;
  readonly vaultType: string;
  readonly durationSeconds: number;
  readonly suggestedSide?: "yes" | "no";
  readonly suggestedStake?: bigint;
  readonly observationRef?: string;
}
```

### Similarity (host)

```ts
export interface SimilarityQuery {
  readonly marketId: string;
  readonly vaultDraft: VaultDraft;
}

export interface SimilarityCandidate {
  readonly kind: "vault";
  readonly vaultId: string;
  readonly marketId: string;
  readonly score: number;
  readonly reason: string;
  readonly suggestedAction: "join-existing" | "create-new" | "skip";
}

export interface SimilarityResult {
  readonly marketId: string;
  readonly candidates: readonly SimilarityCandidate[];
  readonly duplicateRisk?: "low" | "medium" | "high";
  readonly stewardWarnings?: readonly string[];
}
```

### Bookmaker decision

```ts
export type BookmakerDecision =
  | { readonly action: "createVault"; readonly draft: VaultDraft; readonly detection: Detection }
  | { readonly action: "joinVault"; readonly vaultId: string; readonly draft: VaultDraft; readonly detection: Detection }
  | { readonly action: "skip"; readonly reason: BookmakerSkipReason; readonly detection?: Detection };

export type BookmakerSkipReason =
  | "no_detectors"
  | "no_detection"
  | "below_confidence_threshold"
  | "duplicate_vault"
  | "steward_warning"
  | "invalid_draft"
  | "market_not_found"
  | "market_inactive";
```

### Write plan

```ts
export interface BookmakerWritePlan {
  readonly decision: BookmakerDecision;
  readonly calls: readonly BookmakerContractCall[];  // from @livestreak/contracts write encoders
}

export interface BookmakerContractCall {
  readonly contract: "vault" | "vaultFactory" | "agentRegistry";
  readonly functionName: string;
  readonly args: readonly unknown[];
}
```

## Core API (target)

Public functions should feel like:

```ts
detectOpportunity(input) -> BookmakerDetectionEvaluation

buildVaultDraft(detection, marketContext, { fundingToken, nowMs }) -> VaultDraft

findSimilar(draft, hostClient) -> Promise<SimilarityResult>

chooseVaultAction(draft, candidates, policy) -> BookmakerDecision

planBookmakerWrite(decision, contracts) -> BookmakerWritePlan

executeBookmakerWrite(plan, walletTransport) -> TxResult

projectBookmakerPanel(runtime) -> BookmakerPanelView
```

Not:

```ts
createMarket          // observe + contracts
createVault blindly   // without similarity + explicit decision
stream / setFundingRate
readUserPositions
```

## Reference shape — `src/`

Six top-level regions (observe-style layout). Moves only — public exports unchanged.

```text
packages/bookmaker/src/
  index.ts              re-exports only (6-region cluster)

  model/
    market-context.ts   BookmakerMarketContext
    watch-source.ts     BookmakerWatchSource, BookmakerWatchRef, BookmakerPanelView
    detection.ts        Detection
    vault-draft.ts      VaultDraft
    decision.ts         BookmakerDecision, skip reasons
    similarity.ts       query/result types (host protocol mirrors)
    write-intent.ts     CreateVaultIntent, JoinVaultIntent, buildWriteIntentsFromDecision
    idempotency.ts      vaultKey helpers
    validate.ts         all model validators + ValidationResult primitives
    index.ts

  pipeline/
    observation/        feed boundary, subscription input, event validation
    detection/          PatternDetector, detectOpportunity
    draft/              buildVaultDraft
    similarity/         findSimilar, host adapter, discovery client
    decision/           chooseVaultAction (pure policy)
    index.ts

  chains/
    evm/                reader, writer, encode, create-vault-recovery
    sui/                stub
    index.ts

  flows/
    originate.ts        originateVault
    snapshot.ts         snapshotBookmakerPanel
    index.ts

  runtime/
    config.ts           BookmakerRuntimeConfig
    validate.ts         validateBookmakerRuntimeConfig
    store.ts            in-memory agent state per marketId
    runtime.ts          BookmakerRuntime public owner
    idempotency.ts      at-most-once store
    create-vault-once.ts
    index.ts

  bridge/
    panel/
      project.ts        projectBookmakerPanel
      types.ts          BookmakerPanelSnapshot
    types.ts
    index.ts            callable edge
```

Dependency order (bottom → top):

1. `model/`
2. `pipeline/` (`observation` → `detection` → `draft` → `similarity` → `decision`)
3. `chains/`
4. `flows/`
5. `runtime/`
6. `bridge/`

May import: `@livestreak/host`.
Must **not** depend on `@livestreak/options` or import contract ABI fragments — bookmaker creates vaults; options consumes them; contracts execution stays at the edge.

Pure functions must not read wall-clock time. Pass `nowMs` explicitly to `buildVaultDraft`, `detectOpportunity`, and panel snapshots.

Host similarity types may duplicate in a future `host/` type package later. Until that package exists, `host/docs/architecture.md` is the host source of truth and bookmaker keeps only local host-facing protocol shapes needed for `findSimilar`.

## Runtime config

```ts
export interface BookmakerRuntimeConfig {
  readonly runtimeId: string;
  readonly marketId: string;              // bookmaker works ONE market per runtime instance (v0)
  readonly marketContext: BookmakerMarketContext;
  readonly watchSource: BookmakerWatchSource;
  readonly strategy: {
    readonly detectors: readonly PatternDetector[];
    readonly confidenceThreshold: number;
    readonly duplicatePolicy: "skip-on-high" | "always-create" | "prefer-join";
  };
  readonly chain: {
    readonly chainId: number;
    readonly contracts: {
      readonly marketRegistry: string;
      readonly vault: string;
      readonly token: string;
      readonly agentRegistry?: string;
    };
  };
  readonly host: {
    readonly baseUrl: string;
  };
  readonly account: {
    readonly address: string;
  };
  readonly transport: {
    readonly read?: unknown;
    readonly write?: unknown;            // AA-capable; bundler via host
  };
}
```

One bookmaker runtime per `marketId` in v0 simplifies similarity scope and observation subscription.

## Steward signals (read-only in v0)

Bookmaker may **read** steward/host warnings before deciding. Stewards do not approve creation in v0.

```text
steward warning examples:
  duplicate vault pattern
  flagged bookmaker address
  ruleset / evidence mismatch
  rogue steward annotation on market
```

`chooseVaultAction` may return `skip` with `steward_warning`. No silent override.

## TEE steward model (context)

Stewards as TEE AI agents attach **after** creation:

```text
Bookmaker proposes vaults.
Host helps discover similar vaults inside market.
Contracts record explicit actions.
Stewards judge bad markets/vaults/evidence/resolutions/stewards.
Steward-of-stewards may veto rogue stewards (steward package — not bookmaker).
```

Bookmaker does not run TEE infrastructure.

## Purity rule

Bookmaker is **vanilla TypeScript**. Pure functions do not read wall-clock time — pass `nowMs` explicitly to `buildVaultDraft`, `detectOpportunity`, and panel snapshots.

| Kind | Pattern | Use for |
| --- | --- | --- |
| Pure sync | plain TS functions | `detectOpportunity`, `buildVaultDraft`, `chooseVaultAction`, `validateDetection`, panel projection |
| Injected async | `Promise` from injected clients | `findSimilar`, future write execution at the CLI edge |
| Execution | CLI / host / app edges | runtime loop, AA transport, network I/O |

I/O edges use injected async clients returning `Promise` — **not** Effect. Do not call `fetch`, `Date.now`, or `Effect.run*` inside library `src/`.

If Effect is wanted later, that is a deliberate reintroduction: add the dependency back and design at the application edge first.

## Panel contract

`bridge/panel/` (or `project/panel.ts` initially) answers:

- current market context
- latest detections and confidence
- vault draft under consideration
- similarity candidates and scores
- last decision and skip reason
- pending / completed write plans
- errors and last poll time

Panel does **not** answer: UI layout, user positions, vault odds (options), steward forum content.

## What good code looks like

- Detectors are pluggable; core loop is market-scoped.
- Every write goes through `BookmakerWritePlan` — no surprise `createVault` in detectors.
- Similarity is always queried with `marketId`.
- Skip reasons are explicit and typed.
- Write plans use `BookmakerContractWriteDescriptor` locally (`createVault` with `marketIdBytes` + `question`) until `@livestreak/contracts` restores wagmi-generated write encoders; bookmaker does not import ABI fragments today.
- Bookmaker never imports options.

## What should not be built

Do not create markets in bookmaker v0.

Do not auto-merge or collapse vaults on-chain.

Do not use steward approval as creation gate in v0.

Do not stream user funds or read positions.

Do not duplicate contract ABIs — use contracts package.

Do not copy `-re` `sdk-bookmaker` center on `CreateVaultParams` + `sdk-options` client — port detectors/strategy ideas only.

Do not implement global cross-video similarity.

Do not make bookmaker the truth engine for resolution.

## First build slice

### Step A — architecture + model (now)

```text
docs/architecture.md
model/* types
draft/validate.ts pure tests
```

### Step B — detection + vault draft

```text
strategy/detector.ts, evaluate.ts
draft/build.ts
port PatternDetector ideas from packages-re/sdk-bookmaker
```

Acceptance: detection → valid `VaultDraft` for a fixture `marketId`.

### Step C — similarity + decision (host stub)

```text
similarity/choose.ts
similarity/host-client.ts with fake host for tests
```

Acceptance: duplicate candidate → `skip` or `joinVault`; novel draft → `createVault`.

### Step D — write plan

```text
write/plan.ts wired to @livestreak/contracts write encoders
```

Acceptance: `createVault` plan matches contracts architecture surface.

### Step E — runtime loop

```text
runtime/* — subscribe observations, run loop, store state
```

### Step F — execute + panel + bridge

```text
write/execute.ts, bridge/panel, AA transport injection
```

## Phased delivery

### Slice 1 — pure workflow

```text
detect, draft, decide, plan
fake host similarity
no chain execution
```

### Slice 2 — host similarity

```text
real host findSimilar under marketId
steward warning fields on result
```

### Slice 3 — chain writes

```text
createVault under marketId via AA
agent registry gating if required
```

### Slice 4 — join path + panel

```text
join existing vault action
BookmakerPanel for CLI
BookmakerBridge (later)
```

## Delivery order (repo)

```text
bookmaker architecture     (this doc)
steward architecture       (next)
contracts final alignment  (bookmaker writes + options reads + steward hooks)
schema                     (shared JSON where needed)
host implementation        (similarity index, bundler, forum)
cli architecture
```

Do not implement Solidity until bookmaker + steward write surfaces are clear.

## Relationship to other packages

| Document | Role |
| --- | --- |
| `packages/bookmaker/docs/architecture.md` (this file) | Vault origination workflow |
| `packages/observe/docs/architecture.md` | Observer registers market at stream start |
| `packages/contracts/docs/architecture.md` | `createVault(marketId, ...)`, bookmaker writes |
| `packages/options/docs/architecture.md` | User participation — not creation |
| `host/docs/architecture.md` | Similarity index, bundler, forum records |

### How the layers fit together

```text
observe (stream + register market)
  -> host (index market, findSimilar vaults)
  -> bookmaker (detect, draft, decide, write vault)
  -> contracts (explicit state)
  -> options (users stream YES/NO)
  -> steward (police, hot, dispute, resolution)
```

### Relationship to `-re`

`packages-re/sdk-bookmaker` is a quarry, not a layout template.

Useful to port:

- `PatternDetector`, `evaluateBookmakerDetections` confidence logic
- `DetectionResult` shape (rename to `Detection`, add `marketId` scope)

Do not port:

- `CreateVaultParams` as public center
- dependency on `@livestreak/sdk-options` / `LiveStreakClient`
- market creation implied by `createVault` without `marketId`
- `makeBookmakerAgent.start` as vault factory without observe market context

When porting, rearrange into: **observe market context → vault draft → similarity → decision → contracts write plan**.
