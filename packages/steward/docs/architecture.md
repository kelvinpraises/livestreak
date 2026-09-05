# packages/steward Architecture

This document is for the developer who arrives with no conversation history and needs to move. It keeps steward simple: watch evidence, make accountability decisions, and plan explicit actions. It does not create markets, create vaults, stream funds, or run host infrastructure.

The short version: **`packages/steward` is the accountability workflow package**. Stewards can be humans, bots, or TEE AI agents. They watch markets, vaults, observers, bookmakers, evidence, resolutions, and other stewards. They produce findings and explicit action plans. Contracts store final on-chain actions; host stores forum/thread records; observe/bookmaker/options keep their own jobs.

## The Law

```text
Observe creates the market container from a video stream.
Bookmaker creates or joins vaults under that market.
Options lets users stream into YES/NO vault sides.
Steward watches the evidence and actors.
Steward-of-stewards can veto or penalize rogue stewards.
Host stores forum/index records and serves evidence refs.
Contracts record explicit hot/dispute/resolution/penalty actions.
```

Steward is **not** the market creator, not the bookmaker, and not the host. It is the accountability layer.

## Vocabulary

| Correct term | Meaning |
| --- | --- |
| `Steward` | Accountable actor that reviews evidence and proposes/actions protocol decisions. May be human, bot, or TEE AI agent. |
| `Steward-of-stewards` | Higher authority that can veto or penalize rogue stewards. This is a role/ruleset, not a separate package. |
| `Subject` | Thing being judged: market, vault, observer, bookmaker, steward, evidence, or resolution. |
| `Finding` | Steward's typed observation: duplicate vault, bad evidence, missing cache, bad resolution, rogue actor, etc. |
| `Decision` | Explicit choice: ignore, annotate, open forum thread, trigger hot, challenge, resolve, propose penalty, veto steward. |
| `ActionPlan` | Contract and/or host writes needed to carry out a decision. |
| `Panel` | Read-only projection for CLI/UI: watched subjects, latest findings, decisions, pending plans. |

Do not use these as steward architecture terms:

| Wrong term | Replacement |
| --- | --- |
| Steward creates markets | observe/observer registers markets |
| Steward approves bookmaker creation in v0 | steward emits risk signals after or around creation |
| Steward stores forum data | host stores forum threads/messages |
| Steward owns truth alone | contracts record explicit decisions; steward plans/submits |
| Steward streams funds | options streams user funds |
| Steward runs TEE infra | host/runtime can run TEE agents; steward package owns workflow language |

## Simple E2E Flow

```text
1. Observe stream exists
   marketId points to observeRunId, manifest URI, watch URL, evidence refs.

2. Bookmaker creates or joins vaults
   vaults live under marketId.

3. Steward watches a subject
   subject can be market, vault, observer, bookmaker, evidence, resolution, or another steward.

4. Steward reads facts
   contracts: market/vault/status/positions/hot/dispute state
   host: manifest, cache receipts, forum threads, steward annotations
   observe refs: evidence/watch/telemetry references

5. Steward evaluates rules
   Pure rules produce Findings.

6. Steward chooses a Decision
   ignore
   annotate / open thread
   trigger hot
   challenge resolution
   submit resolution
   propose penalty / slash
   veto rogue steward

7. Steward builds ActionPlan
   host forum write, contract write, or both.

8. Edge executes the plan
   wallet -> host bundler/paymaster -> EntryPoint -> contracts
   host stores forum/message records

9. Contracts and host emit/index results
   options/bookmaker/observe can read the updated status.
```

That is the whole shape for v0. No hidden council runtime, no magical moderation loop, no automatic market grouping.

## Owns

```text
watched subject config
evidence refs and rule inputs
finding types
decision policy
action plan shapes
steward runtime state and panel projection
TEE attestation metadata as input context
steward-of-stewards veto/penalty workflow language
```

## Does Not Own

```text
market registration                    -> observe + contracts edge write
vault creation                         -> bookmaker
user funding streams / positions       -> options
forum storage                          -> host
video capture / evidence production    -> observe
host cache / WebRTC / TEE infra        -> host/runtime
contract ABI authority                 -> @livestreak/contracts
wallet secrets                         -> CLI / app / gateway
```

## TEE Steward Model

TEE matters as **evidence about who ran a steward decision**, not as a reason to hide logic in this package.

```text
TEE steward:
  receives watched subject + evidence refs
  evaluates rules
  signs finding / decision / action plan
  may include attestation quote or report ref

Steward-of-stewards:
  monitors steward decisions
  challenges or vetoes rogue steward actions
  may propose penalties against a steward
```

The package should model TEE attestation refs and steward identity. It should not run the enclave or host the attestation service.

## Reference Shape

```text
packages/steward/src/
  index.ts              re-exports only

  bridge/
    bridge.ts           createStewardBridge (plans only — edge executes)
    types.ts            scopes + StewardBridge interface
    scope.ts            capability authorization
    panel/              panel + functions registry projection

  workflow/
    facts/              StewardFact + TeeAttestationRef metadata
    rules/              pure rule evaluation
    decision/           pure decision policy
    action/             pure action planning

  model/                subject, finding, decision, action-plan, panel view
  validate/             subject/finding/decision/action-plan validators
  runtime/              injected fact-source loop, board, revision snapshot
```

Dependency order:

1. `model/` + `workflow/facts/`
2. `validate/`
3. `workflow/rules` → `decision` → `action`
4. `bridge/panel/`
5. `runtime/`
6. `bridge/`

May import: `@livestreak/core`, `@livestreak/contracts` when write encoders exist, and `@livestreak/schema` for shared public shapes.

Must **not** depend on `@livestreak/options` or `@livestreak/bookmaker`.

## Core API Target

Public surface should feel like:

```ts
evaluateStewardRules(subject, facts, ruleset) -> StewardFinding[]

chooseStewardDecisions(findings, policy) -> StewardDecision[]

planStewardActions(decisions, actionContext) -> StewardActionPlan[]

createStewardRuntime(config) -> { refresh, readBoard, readPanel, subscribeBoard, ... }

createStewardBridge({ runtime }) -> {
  readBoard(caller),
  readControls(caller),      // StewardControlsView + functions registry
  callAction(caller, env),   // returns StewardActionPlan — does NOT execute
  subscribeBoard(caller, listener)
}
```

Not:

```ts
createMarket
createVault
streamFunds
storeForumThread
runTeeEnclave
executeContractWrite   // edge only
```

## First Build Slice

Keep the first slice model-only:

```text
docs/architecture.md
model/* types
facts/* + validate/*
rules/decision/action/panel pure functions
no runtime
no bridge
no chain execution
```

Next slices:

```text
1. richer rulesets and fact adapters
2. contract/host write planning refinements
3. runtime watch loop
4. bridge/panel only when runtime exists
```

## Relationship To Other Packages

| Package/doc | Role |
| --- | --- |
| `packages/observe/docs/architecture.md` | Market/video evidence source |
| `packages/bookmaker/docs/architecture.md` | Vault origination under marketId |
| `packages/options/docs/architecture.md` | User funding, claims, FLOW |
| `packages/contracts/docs/architecture.md` | Hot/dispute/resolution/penalty writes |
| `host/docs/architecture.md` | Forum records, cache receipts, AA bundler/paymaster, TEE/runtime hosting later |

Simple relationship:

```text
observe -> contracts registers market
bookmaker -> contracts creates vault
options -> contracts streams/funds/claims
steward -> contracts/host records accountability action
host -> indexes and stores evidence/forum/AA edges
```

## Relationship To Old `sdk-steward`

`packages-old/sdk-steward` and `packages-re/sdk-steward` are quarries, not layout templates.

Useful to port:

- vault health flags
- resolution watcher idea
- challenge/proposal shape
- agent/steward tracking concepts

Do not port:

- Circle wallet wrapper as package-owned wallet UX
- hidden polling loop as the public center
- steward staking mixed with consumer FLOW staking
- direct contract ABI fragments copied into steward

When porting, rearrange into: **subject -> facts -> findings -> decision -> action plan**.
