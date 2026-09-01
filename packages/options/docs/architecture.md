# @livestreak/options Architecture

This document is for the developer who arrives with no conversation history and needs to move. It explains the architecture we want, why the folders exist, what should not be built, and how a running options runtime ties chain reads, user positions, funding streams, and UI/CLI panel projection together.

The short version: **`packages/options` is the market/vault consumer workflow package**. It does not create markets. It does not create vaults. It lets a user discover markets and vaults, inspect vault state, stream funds into YES/NO sides, track positions, check **resolved** outcome stats for vaults they funded, surface when the user can claim or release winnings, and manage the consumer $LVST state that comes from loss claims and staking. The UI never reads contract storage directly — it asks options for `MarketView` / `VaultView` / `ResolvedVaultView` / `LvstAccountView`, and options does the read and projection.

## Vocabulary

Use these terms in code and docs:

| Correct term | Meaning |
| --- | --- |
| `Market` | Parent grouping/index. v0: indexed on-chain for test simplicity. Later may move to host/indexer/off-chain. Contains multiple vaults. |
| `Vault` | One prediction pool inside a market. v0: binary YES/NO. Has status, totals, timing, steward/hot state, resolution state. |
| `Side` | `yes` or `no`. User may hold both at the same time — hedging is allowed and expected because there is no selling. |
| `Position` | User exposure keyed by `account + vault + side`. Separate YES and NO positions per vault. |
| `Funding stream` | Contract-level streaming/drip mechanism. Slider controls rate. Rate `0` means stopped/paused — no separate pause protocol. |
| `Claim` / `Release` | Post-resolution value recovery. Options watches vault/user state and surfaces availability through panel/actions. |
| `Loss claim` | $LVST reward made available because the user lost value in a resolved vault. Options reads, projects, and can claim/stake it for the consumer. |
| `LVST account` | User-facing $LVST balance, staked amount, pending dividends, and loss-claim availability. This is consumer token state, not steward governance state. |
| `Stake loss claim` | Claim available loss $LVST and stake it through the token/staking contract flow. Options owns this consumer action surface. |
| `Resolved` | Post-resolution vault state for vaults the user funded. The read model for outcome, final pools, per-side results, PnL, and claim/release status — not live odds or streaming controls. |
| `OptionsVaultSnapshot` | Normalized in-package vault state after chain read + decode. |
| `OptionsVaultView` | UI/CLI-ready projection for **live/open** vaults: string USDC amounts and computed odds. |
| `OptionsResolvedVaultView` | UI/CLI-ready projection for **resolved** vaults: winning side, final pools, user result stats, claimability. |
| `OptionsLvstAccountView` | UI/CLI-ready projection for $LVST balance, staked amount, pending dividends, and loss-claim actions. |
| `OptionsRuntime` | In-memory owner of snapshots, polling, and callable workflow functions. |
| `OptionsBridge` | Authorized callable edge for CLI/UI/gateway (later slice; mirrors observe Bridge pattern). |
| `OptionsPanel` | Projected read model: markets, vaults, user positions, funding rates, available actions. |

Do not use these as options architecture terms:

| Old term | Replacement |
| --- | --- |
| `CreateVaultParams` as public center | `MarketSnapshot`, `VaultSnapshot`, `readVault`, `setFundingRate` |
| `createVault` / `createOption` in options | Market/vault creation belongs to bookmaker + contracts |
| `option` (ambiguous) | `Vault` or `Market` depending on context |
| `stream` (verb only) | `FundingStream`, `setFundingRate`, `stopFundingStream` |
| Session keys | Normal AA/wallet execution injected by caller — not designed in options v0 |
| Observe `session` / `run` | Options `runtimeId` — different domain |

## What Options Is

```text
packages/options = market/vault consumer workflow
```

It is the bridge between the UI's prediction-market experience and on-chain contracts.

Design center:

```text
MarketSnapshot
VaultSnapshot
ResolvedVaultSnapshot
UserVaultState
FundingStreamState
LvstAccountState
OptionsPanel / View
```

Not `CreateVaultParams` as the main public story.

### Core entities

```text
Market
  parent grouping/index
  v0: indexed on-chain for test simplicity
  later: may move to host/indexer/off-chain for cheaper contracts
  contains multiple vaults

Vault
  one prediction pool inside a market
  v0: binary YES/NO
  future multi-outcome: market can contain multiple vaults/outcomes
  has status, totals, timing, steward/hot state, resolution state

Position
  keyed by user + vault + side
  user may hold YES and NO at the same time
  hedging is allowed and expected because there is no selling

Funding stream
  contract-level streaming/drip mechanism
  slider controls the rate
  rate = 0 means stopped/paused
  no separate pause protocol needed

Claim / release
  options watches vault/user state
  when user wins or funds become releasable, options surfaces that through panel/state

Loss claim / LVST staking
  when user loses, contracts may mint or unlock $LVST loss rewards
  options reads available loss claims, LVST balance, staked amount, pending dividends
  options exposes claim/stake actions so losers can become protocol owners
  consumer LVST staking belongs here; steward proposal staking belongs to steward

Resolved
  vault status is resolved or disputed-with-known-outcome
  user had (or still has) position exposure on that vault
  options exposes ResolvedVaultView: winning side, what you streamed, what you won/lost,
    claimable vs claimed/released, final pool breakdown
  this is the view you open to check how a vault you kept money into turned out
```

## Three-Layer State Model

Vaults need raw protocol shape, normalized snapshot, and projected view.

```text
ContractVaultState      raw-ish chain state (via contracts package reads)
OptionsVaultSnapshot    normalized package state
OptionsVaultView        UI/CLI-ready projection
```

Same pattern for markets, user positions, and resolved vaults:

```text
ContractMarketState   ->  OptionsMarketSnapshot    ->  OptionsMarketView
ContractVaultState    ->  OptionsVaultSnapshot     ->  OptionsVaultView        (live/open)
ContractVaultState    ->  OptionsResolvedVaultSnapshot -> OptionsResolvedVaultView (resolved)
ContractPosition      ->  OptionsUserVaultState    ->  OptionsUserVaultView
ContractFlowState     ->  OptionsLvstAccountState  ->  OptionsLvstAccountView
```

Use `readVault` + `projectVaultView` while a vault is open, hot, or locked. Use `readResolvedVault` + `projectResolvedVaultView` once resolution is final — that path owns outcome stats and post-resolution user results. Do not overload live `VaultView` with resolved-only fields; keep resolved as its own projection.

### Market snapshot

```ts
export interface OptionsMarketSnapshot {
  readonly marketId: string;
  readonly title: string;
  readonly streamId?: string;
  readonly category?: string;
  readonly status: OptionsMarketStatus;
  readonly vaultIds: readonly string[];
  readonly timing?: OptionsMarketTiming;
}

export type OptionsMarketStatus =
  | "open"
  | "locked"
  | "resolved"
  | "disputed";

export interface OptionsMarketTiming {
  readonly createdAtMs?: number;
  readonly closesAtMs?: number;
  readonly resolvedAtMs?: number;
}
```

### Market view

Derived totals are computed inside options — never in UI.

```ts
export interface OptionsMarketView {
  readonly marketId: string;
  readonly title: string;
  readonly streamId?: string;
  readonly category?: string;
  readonly status: OptionsMarketStatus;
  readonly vaultIds: readonly string[];
  readonly totals: {
    readonly pooledUSDC: string;
    readonly activeVaults: number;
    readonly resolvedVaults: number;
  };
  readonly timing?: OptionsMarketTiming;
}
```

Derivation:

```ts
vault.totalPool = sidePools.yes + sidePools.no
market.totals.pooledUSDC = sum(vault.totalPool)
```

### Vault snapshot

```ts
export interface OptionsVaultSnapshot {
  readonly vaultId: string;
  readonly marketId: string;
  readonly question: string;
  readonly type: OptionsVaultType;
  readonly creator: string;
  readonly status: OptionsVaultStatus;
  readonly outcome: OptionsVaultOutcome;
  readonly pools: OptionsVaultPools;
  readonly timing: OptionsVaultTiming;
  readonly steward: OptionsVaultStewardState;
  readonly user?: OptionsUserVaultState;
}

export type OptionsVaultType =
  | "momentum"
  | "player"
  | "threshold"
  | "timing"
  | "swing"
  | (string & {});

export type OptionsVaultStatus =
  | "open"
  | "hot"
  | "locked"
  | "resolved"
  | "disputed";

export type OptionsVaultOutcome =
  | "pending"
  | "yes"
  | "no";

export interface OptionsVaultPools {
  readonly yes: bigint;
  readonly no: bigint;
}

export interface OptionsVaultTiming {
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly lockedAtMs?: number;
  readonly resolvedAtMs?: number;
}

export interface OptionsVaultStewardState {
  readonly stewardId?: string;
  readonly hot: boolean;
  readonly hotUntilMs?: number;
  readonly hotReason?: string;
  readonly exitBurnBps?: number;
  readonly disputeId?: string;
}
```

### Vault view

Bigints become strings for UI/CLI JSON.

```ts
export interface OptionsVaultView {
  readonly vaultId: string;
  readonly marketId: string;
  readonly question: string;
  readonly type: OptionsVaultType;
  readonly creator: string;
  readonly status: OptionsVaultStatus;
  readonly outcome: OptionsVaultOutcome;
  readonly pools: {
    readonly yesUSDC: string;
    readonly noUSDC: string;
    readonly totalUSDC: string;
  };
  readonly odds: {
    readonly yesMultiplier: number;
    readonly noMultiplier: number;
    readonly yesProbabilityBps: number;
    readonly noProbabilityBps: number;
  };
  readonly timing: OptionsVaultTiming;
  readonly steward: OptionsVaultStewardState;
  readonly user?: OptionsUserVaultView;
}
```

### User vault state (snapshot layer)

```ts
export interface OptionsUserVaultState {
  readonly account: string;
  readonly positions: {
    readonly yes: OptionsSidePositionState;
    readonly no: OptionsSidePositionState;
  };
  readonly funding: {
    readonly yes: OptionsFundingStreamState;
    readonly no: OptionsFundingStreamState;
  };
  readonly lossClaim?: OptionsLossClaimState;
}

export interface OptionsSidePositionState {
  readonly side: "yes" | "no";
  readonly streamed: bigint;
  readonly shares: bigint;
  readonly currentValue: bigint;
  readonly claimable: bigint;
  readonly released: boolean;
}

export interface OptionsFundingStreamState {
  readonly side: "yes" | "no";
  readonly ratePerSecond: bigint;
  readonly ratePerMinute: bigint;
  readonly active: boolean;
  readonly updatedAtMs?: number;
}

export interface OptionsLossClaimState {
  readonly vaultId: string;
  readonly claimable: bigint;
  readonly claimed: bigint;
  readonly staked: bigint;
}
```

### User vault view (projection layer)

```ts
export interface OptionsUserVaultView {
  readonly account: string;
  readonly positions: {
    readonly yes: OptionsSidePositionView;
    readonly no: OptionsSidePositionView;
  };
  readonly totals: {
    readonly streamedUSDC: string;
    readonly shares: string;
    readonly currentValueUSDC: string;
    readonly claimableUSDC: string;
    readonly estimatedPnlUSDC: string;
  };
  readonly activeFunding: {
    readonly yesRatePerMinuteUSDC: string;
    readonly noRatePerMinuteUSDC: string;
    readonly totalRatePerMinuteUSDC: string;
  };
  readonly actions: {
    readonly canStreamYes: boolean;
    readonly canStreamNo: boolean;
    readonly canStopYes: boolean;
    readonly canStopNo: boolean;
    readonly canClaim: boolean;
    readonly canRelease: boolean;
    readonly canClaimLossFlow: boolean;
    readonly canStakeLossFlow: boolean;
  };
}

export interface OptionsSidePositionView {
  readonly side: "yes" | "no";
  readonly streamedUSDC: string;
  readonly shares: string;
  readonly currentValueUSDC: string;
  readonly claimableUSDC: string;
  readonly fundingRatePerMinuteUSDC: string;
  readonly isWinningSide: boolean | null;
}
```

### LVST account state

Consumer $LVST state is part of options because it comes from the market/vault experience. This is not steward governance staking.

```ts
export interface OptionsLvstAccountState {
  readonly account: string;
  readonly balance: bigint;
  readonly staked: bigint;
  readonly pendingDividends: bigint;
  readonly totalEarned?: bigint;
  readonly lossClaims: {
    readonly claimable: bigint;
    readonly claimed: bigint;
    readonly stakedFromClaims: bigint;
  };
}

export interface OptionsLvstAccountView {
  readonly account: string;
  readonly balanceLVST: string;
  readonly stakedLVST: string;
  readonly unstakedLVST: string;
  readonly pendingDividendsUSDC: string;
  readonly totalEarnedLVST?: string;
  readonly lossClaims: {
    readonly claimableLVST: string;
    readonly claimedLVST: string;
    readonly stakedFromClaimsLVST: string;
  };
  readonly actions: {
    readonly canStake: boolean;
    readonly canUnstake: boolean;
    readonly canClaimDividends: boolean;
    readonly canClaimLossFlow: boolean;
    readonly canStakeLossClaim: boolean;
  };
}
```

### Resolved vault snapshot

Normalized state after resolution. Reuses vault identity and pools; adds final outcome and user result fields.

```ts
export interface OptionsResolvedVaultSnapshot {
  readonly vaultId: string;
  readonly marketId: string;
  readonly question: string;
  readonly type: OptionsVaultType;
  readonly creator: string;
  readonly status: "resolved" | "disputed";
  readonly outcome: "yes" | "no";
  readonly pools: OptionsVaultPools;
  readonly timing: OptionsVaultTiming & {
    readonly resolvedAtMs: number;
  };
  readonly steward: OptionsVaultStewardState;
  readonly user: OptionsUserResolvedVaultState;
}

export interface OptionsUserResolvedVaultState {
  readonly account: string;
  readonly positions: {
    readonly yes: OptionsResolvedSidePositionState;
    readonly no: OptionsResolvedSidePositionState;
  };
  readonly totals: {
    readonly streamed: bigint;
    readonly returned: bigint;
    readonly claimable: bigint;
    readonly claimed: bigint;
    readonly released: bigint;
    readonly netPnl: bigint;
  };
  readonly result: "win" | "loss" | "mixed" | "break_even";
  readonly winningSides: readonly ("yes" | "no")[];
  readonly lossClaim?: OptionsLossClaimState;
}
```

```ts
export interface OptionsResolvedSidePositionState {
  readonly side: "yes" | "no";
  readonly streamed: bigint;
  readonly shares: bigint;
  readonly returned: bigint;
  readonly claimable: bigint;
  readonly claimed: bigint;
  readonly released: boolean;
  readonly won: boolean;
}
```

### Resolved vault view

The view for checking how a vault you funded turned out. No live odds or streaming actions.

```ts
export interface OptionsResolvedVaultView {
  readonly vaultId: string;
  readonly marketId: string;
  readonly question: string;
  readonly type: OptionsVaultType;
  readonly creator: string;
  readonly status: "resolved" | "disputed";
  readonly outcome: "yes" | "no";
  readonly pools: {
    readonly yesUSDC: string;
    readonly noUSDC: string;
    readonly totalUSDC: string;
    readonly winningSideUSDC: string;
    readonly losingSideUSDC: string;
  };
  readonly timing: OptionsVaultTiming & {
    readonly resolvedAtMs: number;
  };
  readonly steward: OptionsVaultStewardState;
  readonly user: OptionsUserResolvedVaultView;
}

export interface OptionsUserResolvedVaultView {
  readonly account: string;
  readonly positions: {
    readonly yes: OptionsResolvedSidePositionView;
    readonly no: OptionsResolvedSidePositionView;
  };
  readonly totals: {
    readonly streamedUSDC: string;
    readonly returnedUSDC: string;
    readonly claimableUSDC: string;
    readonly claimedUSDC: string;
    readonly releasedUSDC: string;
    readonly netPnlUSDC: string;
  };
  readonly result: "win" | "loss" | "mixed" | "break_even";
  readonly winningSides: readonly ("yes" | "no")[];
  readonly actions: {
    readonly canClaim: boolean;
    readonly canRelease: boolean;
    readonly canViewReceipt: boolean;
    readonly canClaimLossFlow: boolean;
    readonly canStakeLossFlow: boolean;
  };
}

export interface OptionsResolvedSidePositionView {
  readonly side: "yes" | "no";
  readonly streamedUSDC: string;
  readonly shares: string;
  readonly returnedUSDC: string;
  readonly claimableUSDC: string;
  readonly claimedUSDC: string;
  readonly released: boolean;
  readonly won: boolean;
}
```

`listResolvedVaults` returns vaults where `user` had non-zero streamed exposure and `status` is `resolved` or terminal `disputed`. `readResolvedVault` is the detail read for one vault's resolved stats.

### Example vault view JSON

```json
{
  "vaultId": "vault_01",
  "marketId": "market_01",
  "question": "Speaker addresses regulation next",
  "status": "open",
  "pools": {
    "yesUSDC": "94000000",
    "noUSDC": "185000000",
    "totalUSDC": "279000000"
  },
  "odds": {
    "yesMultiplier": 2.31,
    "noMultiplier": 1.51,
    "yesProbabilityBps": 3369,
    "noProbabilityBps": 6631
  },
  "user": {
    "account": "0xabc...",
    "positions": {
      "yes": {
        "side": "yes",
        "streamedUSDC": "25000000",
        "shares": "34000000",
        "currentValueUSDC": "28500000",
        "claimableUSDC": "0",
        "fundingRatePerMinuteUSDC": "800000",
        "isWinningSide": null
      },
      "no": {
        "side": "no",
        "streamedUSDC": "0",
        "shares": "0",
        "currentValueUSDC": "0",
        "claimableUSDC": "0",
        "fundingRatePerMinuteUSDC": "0",
        "isWinningSide": null
      }
    },
    "activeFunding": {
      "yesRatePerMinuteUSDC": "800000",
      "noRatePerMinuteUSDC": "0",
      "totalRatePerMinuteUSDC": "800000"
    },
    "actions": {
      "canStreamYes": true,
      "canStreamNo": true,
      "canStopYes": true,
      "canStopNo": false,
      "canClaim": false,
      "canRelease": false,
      "canClaimLossFlow": false,
      "canStakeLossFlow": false
    }
  }
}
```

### Example resolved vault view JSON

```json
{
  "vaultId": "vault_01",
  "marketId": "market_01",
  "question": "Speaker addresses regulation next",
  "status": "resolved",
  "outcome": "yes",
  "pools": {
    "yesUSDC": "412000000",
    "noUSDC": "185000000",
    "totalUSDC": "597000000",
    "winningSideUSDC": "412000000",
    "losingSideUSDC": "185000000"
  },
  "timing": {
    "createdAtMs": 1730000000000,
    "expiresAtMs": 1730001800000,
    "resolvedAtMs": 1730001750000
  },
  "user": {
    "account": "0xabc...",
    "result": "win",
    "winningSides": ["yes"],
    "positions": {
      "yes": {
        "side": "yes",
        "streamedUSDC": "25000000",
        "shares": "34000000",
        "returnedUSDC": "58000000",
        "claimableUSDC": "58000000",
        "claimedUSDC": "0",
        "released": false,
        "won": true
      },
      "no": {
        "side": "no",
        "streamedUSDC": "0",
        "shares": "0",
        "returnedUSDC": "0",
        "claimableUSDC": "0",
        "claimedUSDC": "0",
        "released": false,
        "won": false
      }
    },
    "totals": {
      "streamedUSDC": "25000000",
      "returnedUSDC": "58000000",
      "claimableUSDC": "58000000",
      "claimedUSDC": "0",
      "releasedUSDC": "0",
      "netPnlUSDC": "33000000"
    },
    "actions": {
      "canClaim": true,
      "canRelease": false,
      "canViewReceipt": true,
      "canClaimLossFlow": false,
      "canStakeLossFlow": false
    }
  }
}
```

### Key derivation rules

```text
Vault total pool     = yes pool + no pool
Market total pool    = sum(vault total pools)
User may hold both YES and NO positions on the same vault
Funding stream exists per side
Stopping/pause       = set rate to 0
Hot state            = steward-owned; options only reads/projects it
Odds/multipliers     = computed in options from side pools, not stored in UI
Resolved stats       = only in ResolvedVaultView; live VaultView omits final outcome/PnL
User result          = win | loss | mixed | break_even from per-side won + netPnl
listResolvedVaults   = vaults user funded that reached resolved/disputed terminal state
Loss FLOW            = resolved user loss claim; options surfaces claim/stake actions
LVST staking         = consumer balance/stake/dividend flow; steward proposal staking is separate
```

## Reference Shape

Target package layout (slice 1 ships `model/`, `read/`, `panel/`; `project/` is an alias target for later refactors):

```text
packages/options/src/
  index.ts              re-exports only

  model/
    market.ts           market snapshot + view types
    vault.ts            vault snapshot + view types
    resolved.ts         resolved vault snapshot + view types
    position.ts         user position + side types
    funding.ts          funding stream state types
    flow.ts             LVST account + loss claim state types
    odds.ts             pure odds/multiplier math
    index.ts

  read/
    contracts.ts        decode contract reads -> snapshots
    markets.ts          listMarkets, readMarket
    vaults.ts           listVaults, readVault, readVaultPositions
    resolved.ts         listResolvedVaults, readResolvedVault
    funding.ts          readFundingStreams
    flow.ts             readLvstAccount, readLossClaims
    index.ts

  project/
    market.ts           snapshot -> MarketView
    vault.ts            snapshot -> VaultView (+ odds, live actions)
    resolved.ts         snapshot -> ResolvedVaultView (+ outcome stats)
    flow.ts             LvstAccountState -> LvstAccountView
    panel.ts            projectOptionsPanel
    index.ts

  write/
    funding.ts          setFundingRate, stopFundingStream
    claim.ts            claimVault, releaseVault
    flow.ts             stakeFlow, unstakeFlow, claimFlowDividends, claimAndStakeLossFlow
    index.ts

  runtime/
    config.ts           OptionsRuntimeConfig validation
    store.ts            in-memory snapshot registry
    poll.ts             polling loop / refresh scheduler
    runtime.ts          OptionsRuntime public owner
    index.ts

  bridge/
    bridge.ts           callable edge (later slice)
    panel/
      project.ts        panel atoms/cards/actions
      types.ts
    types.ts
    index.ts
```

Dependency order (bottom → top):

1. `model/`
2. `read/`
3. `project/`
4. `write/`
5. `runtime/`
6. `bridge/`

Each layer may import from layers below, not above.

`bridge/panel/` stays vanilla TypeScript — no Effect unless strictly necessary, same as observe.

## Public API (`src/index.ts`)

External callers (app, `cli-re2`, tests) should import from the package root.

**Root exports should include:**

- **Model types** — `OptionsMarketSnapshot`, `OptionsMarketView`, `OptionsVaultSnapshot`, `OptionsVaultView`, `OptionsResolvedVaultSnapshot`, `OptionsResolvedVaultView`, `OptionsUserVaultState`, `OptionsUserVaultView`, `OptionsUserResolvedVaultView`, `OptionsLvstAccountState`, `OptionsLvstAccountView`, funding and position types.
- **Read functions** — `listMarkets`, `readMarket`, `listVaults`, `readVault`, `listResolvedVaults`, `readResolvedVault`, `readVaultPositions`, `readFundingStreams`, `readLvstAccount`, `readLossClaims` (Effect blueprints with injected transport).
- **Write functions** — `setFundingRate`, `stopFundingStream`, `claimLossFlow`, `stakeFlow`, `unstakeFlow` (vanilla async over injected `ContractWriter`). **Blocked until contracts ship:** `claimVault`, `releaseVault`, `claimFlowDividends`, `claimAndStakeLossFlow`.
- **Projection** — `projectMarketView`, `projectVaultView`, `projectResolvedVaultView`, `projectLvstAccountView`, `projectOptionsPanel`.
- **Runtime** — `createOptionsRuntime`, `OptionsRuntimeConfig`, store helpers, poll controls.
- **Pure math** — odds/multiplier helpers from `model/odds.ts`.

**Not root-exported (internal at first):**

- Raw ABI decode helpers unless needed by integrators.
- Polling fiber internals.
- Bridge implementation details until the bridge slice ships.

Public functions should feel like:

```ts
listMarkets
readMarket
listVaults
readVault
listResolvedVaults
readResolvedVault
readVaultPositions
readFundingStreams
readLvstAccount
readLossClaims
setFundingRate
stopFundingStream
claimVault
releaseVault
stakeFlow
unstakeFlow
claimFlowDividends
claimAndStakeLossFlow
projectOptionsPanel
projectResolvedVaultView
projectLvstAccountView
```

Not:

```ts
createVault
createOption
makeLiveStreakClient   // legacy -re framing; do not revive as options center
```

## Top-Level Model

```text
APP / CLI / GATEWAY
  createOptionsRuntime(config)
  readPanel / projectOptionsPanel
  listMarkets / readVault
  listResolvedVaults / readResolvedVault   # vaults you funded — outcome stats
  readLvstAccount                          # LVST balance, stake, dividends, loss claims
  setFundingRate / stopFundingStream
  claimVault when actions.canClaim
  claimAndStakeLossFlow when actions.canStakeLossFlow

OPTIONS RUNTIME
  in-memory snapshot store
  polling loop (chain reads)
  last poll time, errors, available functions
  no durable hidden storage
  separate live vault cache vs resolved vault cache (or status-keyed entries)
  LVST balance/staked/dividend + loss-claim cache

READ LAYER
  contract reads via @livestreak/contracts + injected transport
  decode -> MarketSnapshot / VaultSnapshot / ResolvedVaultSnapshot / UserVaultState / LvstAccountState

PROJECT LAYER
  snapshot -> MarketView / VaultView / ResolvedVaultView / LvstAccountView / OptionsPanel
  derive totals, odds (live only), resolved outcome stats, actions

WRITE LAYER
  setFundingRate / claim / release / FLOW stake + loss-claim stake
  injected AA/wallet write transport (no session keys v0)

BRIDGE (later)
  authorized callable edge
  readPanel, callFunction, subscribeBoard
```

Options is not just stateless RPC. It needs an in-memory runtime because it must track and expose:

```text
market/vault snapshots
resolved vault snapshots (outcome + user result)
user positions
active stream rates
claimable/releasable state
winner status
errors and last poll time
available functions
```

This mirrors observe's runtime/Bridge pattern, but for protocol state rather than media state.

### Runtime surface (target)

```text
OptionsRuntime
  readBoard / readPanel
  callFunction
  subscribeBoard
  startPolling / stopPolling
  refreshMarket / refreshVault

OptionsBridge
  authorized callable edge for CLI/UI/gateway
```

First version can ship with state model + polling loop before full Bridge transport.

## Ownership

### `packages/options` owns

```text
read market list
read market detail
read vaults under market
read vault detail
read resolved vault detail (outcome stats for vaults you funded)
list resolved vaults for account
read user positions for both YES and NO
read active funding stream state
read consumer LVST balance, staked amount, and pending dividends
read loss-claim availability after losing resolved vaults
set/update funding stream rate into a vault side
set funding stream rate to 0
claim/release winnings or resolved value
claim and stake loss FLOW
stake/unstake LVST and claim LVST dividends
compute consumer-facing display state
emit panel/state for UI/CLI
watch/poll enough state to know when action is available
```

### `packages/options` does not own

```text
market creation
vault creation
bookmaker strategy
steward hot/rule decisions
steward proposal/challenge staking
observe media/evidence generation
host cache/storage
CLI preferences
wallet secret custody
session keys (v0)
```

| Concern | Owner |
| --- | --- |
| Market/vault creation | Bookmaker + contracts |
| Steward hot/dispute decisions | Steward package + contracts |
| Steward governance staking | Steward package + contracts |
| Consumer LVST balance/staking/loss claims | `packages/options` |
| Media capture and evidence | `packages/observe` |
| Hosted cache/manifests | `host/` + `packages/host` |
| Wallet/AA execution wiring | Caller/gateway/host — injected into options |
| UI layout and icons | `app/` |

## Runtime Config

Options needs explicit config at runtime creation:

```ts
export interface OptionsRuntimeConfig {
  readonly runtimeId: string;
  readonly chain: {
    readonly chainId: number;
    readonly contracts: {
      readonly marketRegistry: string;
      readonly vault: string;
      readonly token: string;
      readonly flowToken: string;
      readonly flowStaking: string;
    };
  };
  readonly account: {
    readonly address: string;
  };
  readonly transport: {
    readonly read: unknown;
    readonly write?: unknown;
  };
  readonly polling?: {
    readonly intervalMs: number;
  };
}
```

`token` is the funding token used for vault streams, for example USDC. `flowToken` and `flowStaking` are the consumer FLOW token/staking surfaces used for balances, loss claims, and dividends. Exact contract names and ABIs lock in during the contracts pass. Options validates the config envelope; contract decode lives in `read/contracts.ts`.

## Wallet / AA Direction

For now:

```text
No session keys.
Use normal account abstraction.
End direction: user has a wallet that can drip funds into vaults.
```

Options should not design around session-key flows yet. It accepts an AA/wallet execution surface from the caller/gateway/host setup and uses it to call contract streaming functions. Write transport is injected — options does not custody secrets.

## Contract Requirements

Contracts must expose enough surface for consumer reads and writes. v0 expectations:

```text
market count / market ids
get market
get vault ids for market
get vault
get user position by vault + side
get user funding stream by vault + side
set stream rate / drip into vault
resolve/finalize/claim/release   # claimVault/releaseVault BLOCKED — not on Vault.sol yet
hot/steward state if on-chain for v0
get LVST balance / staked / pending dividends
get loss claim by account + vault, or aggregate loss-claim totals
claim loss FLOW                # claimLossFlow — available
stake / unstake LVST           # skeletonStake / skeletonUnstake — available
claim LVST dividends           # BLOCKED — no LvstToken function yet
```

Critical for hedging:

```text
position(user, vault, YES)
position(user, vault, NO)
```

must be separate reads. Options always models YES and NO as distinct positions.

`@livestreak/contracts` owns ABI artifacts and low-level call encoding. Options owns decode → snapshot → view.

## Boundary With Other Packages

```text
bookmaker  -> creates markets/vaults (producer)
options    -> discovers, reads, funds, claims (consumer)
steward    -> hot/dispute policy (options reads projected state)
observe    -> media/evidence (options may reference streamId only)
host       -> distribution/cache (options does not call host for v0 reads)
app/cli    -> renders OptionsPanel, injects wallet write transport
```

The UI home page vault cards should eventually come from `projectOptionsPanel` or `listVaults` — not hardcoded mock data long term.

Options also owns the consumer FLOW dashboard: balance, staked amount, pending dividends, and loss claims earned from vault outcomes. Steward owns governance staking and dispute/challenge rules.

## Purity Rule (Effect)

Same rule as observe:

| Kind | Pattern | Use for |
| --- | --- | --- |
| Vanilla pure | plain TS functions | `projectVaultView`, odds math, action flags, panel projection |
| Vanilla async | async functions over injected transport | `setFundingRate`, `stopFundingStream`, `claimLossFlow`, `stakeFlow`, `unstakeFlow` via `ContractWriter` (mirror `ContractReader`) |
| Effect blueprint | returns `Effect`, never runs it | **not used in options v0** — `createOptionsRuntime` and reads are vanilla Promise + injected transport |
| Execution | `Effect.runPromise`, app edge | **not in options `src/`** — app/cli/tests only if a caller chooses Effect |

Do not call `Effect.run*` inside `packages/options` library code.

Inject read/write transport via config or `Context.Tag` at boundaries.

Keep `bridge/panel/` and `project/` vanilla where possible.

## Panel Contract

`bridge/panel/` (or `project/panel.ts` initially) is the canonical read-only projection for UI and CLI.

Panel answers:

- which markets and vaults exist
- pool sizes, odds, status, timing (live vaults)
- **resolved outcome, final pools, win/loss, net PnL** (resolved vaults)
- user positions on YES and NO
- active funding rates per side
- $LVST balance, staked amount, pending dividends, and loss-claim actions
- which actions are enabled and why others are disabled

Route live vault UI to `readVault` / `VaultView`. Route history and "how did my vault do?" UI to `readResolvedVault` / `ResolvedVaultView`. Do not show live streaming controls on resolved vaults.

`OptionsVaultView.user.actions` is the authoritative action surface for **live** funding buttons. `OptionsResolvedVaultView.user.actions` is authoritative for **post-resolution** claim/release. UI should not re-derive either from raw bigint fields.

Panel does **not** answer:

- how the web app styles cards
- raw contract storage slots
- bookmaker creation parameters
- steward internal rule evaluation

## What Good Code Looks Like

- `model/odds.ts` — pure multiplier/probability math from pool bigints.
- `read/vaults.ts` — one place that turns contract output into `OptionsVaultSnapshot`.
- `read/resolved.ts` — `listResolvedVaults`, `readResolvedVault` for vaults the account funded.
- `read/flow.ts` — LVST balance, staked amount, dividends, and loss-claim reads.
- `project/resolved.ts` — snapshot → `ResolvedVaultView` with outcome, PnL, claim actions.
- `project/flow.ts` — LVST account snapshot → `LvstAccountView` with staking/loss actions.
- `project/vault.ts` — snapshot + optional user state → `OptionsVaultView` with string amounts (live only).
- `runtime/store.ts` — keyed snapshots, revision counter, last poll metadata.
- `runtime/poll.ts` — refresh scheduler; failures recorded on runtime, not thrown into UI uncaught.
- `write/funding.ts` — `setFundingRate` and `stopFundingStream` only.
- `write/flow.ts` — `claimLossFlow`, `stakeFlow`, `unstakeFlow`. **Blocked:** `claimFlowDividends`, `claimAndStakeLossFlow`.

Good code follows these rules:

- UI never sums pools or computes odds — options derives totals.
- YES and NO are always separate position reads and separate funding streams.
- Hedging is first-class, not an edge case.
- Resolved vaults use `ResolvedVaultView`, not live `VaultView` with extra fields.
- Loss claims are part of resolved consumer state, not steward-only state.
- Consumer LVST staking lives in options; steward proposal/challenge staking lives in steward.
- Hot/steward fields are read-only in options.
- No market/vault creation in this package.
- Polling updates snapshots; projection is cheap and repeatable.
- Bigint stays inside snapshots; views use strings for JSON safety.

## What Should Not Be Built

Do not center the package on `CreateVaultParams` or `createVault`.

Do not embed bookmaker or steward decision logic — read their on-chain results only.

Do not overload `VaultView` with resolved outcome/PnL — use `ResolvedVaultView`.

Do not put consumer LVST staking in steward just because stewards also stake — options owns user balance/loss-claim staking, steward owns governance staking.

Do not duplicate observe run lifecycle or host manifest flows.

Do not add session-key flows in v0.

Do not let the app read contracts directly for vault cards — go through options views.

Do not add durable hidden storage inside options — runtime store is in-memory; chain is source of truth.

Do not build a global singleton runtime — caller owns `OptionsRuntime` lifetime.

Do not call `Effect.run*` in library code.

## First Build Slice

Recommended delivery order:

### Step A — model + projection (pure)

```text
model/market.ts, vault.ts, resolved.ts, position.ts, funding.ts, flow.ts, odds.ts
project/market.ts, vault.ts, resolved.ts, flow.ts, panel.ts
```

Acceptance: unit tests project mock snapshots to views; totals, odds, resolved outcome stats, LVST balances, staked amounts, and loss-claim action flags match derivation rules.

### Step B — read layer (injected fake transport)

```text
read/contracts.ts, markets.ts, vaults.ts, funding.ts, flow.ts
```

Acceptance: fake transport returns fixture bytes; read functions produce market/vault/funding/FLOW snapshots.

### Step C — runtime + polling

```text
runtime/config.ts, store.ts, poll.ts, runtime.ts
```

Acceptance: in-memory store refreshes on interval; panel reads latest snapshots.

### Step D — write layer

```text
write/funding.ts, claim.ts, flow.ts
```

Acceptance: injected write transport receives `setFundingRate` / `claimVault` / `claimAndStakeLossFlow` calls; runtime refreshes after write.

### Step E — bridge + app wiring

```text
bridge/ (panel projection + callable edge)
app/ consumes projectOptionsPanel instead of mocks
```

Acceptance: UI vault cards driven from options runtime in dev with local chain or fixtures.

## Phased Delivery

### Slice 1 — read model + panel (current target)

```text
pure model + projection
fake/injected read transport
in-memory runtime store
polling loop stub
no writes
no bridge auth
```

### Slice 2 — real chain reads (v0 contracts)

```text
wire @livestreak/contracts
listMarkets / readVault against testnet/local
panel driven from live reads
```

### Slice 3 — runtime + polling (shipped)

```text
createOptionsRuntime, manual refresh, opt-in polling
in-memory store + panel projection
```

### Slice 4a — funding + FLOW writes (shipped)

```text
setFundingRate / stopFundingStream
claimLossFlow / stakeFlow / unstakeFlow
injected ContractWriter (no viem in package)
```

### Slice 4b — claim/release + dividends (blocked on contracts)

```text
claimVault / releaseVault        # no user claim/release on Vault.sol yet
claimFlowDividends               # no LvstToken function
claimAndStakeLossFlow            # no combined function; use claimLossFlow + stakeFlow separately
```

### Slice 5 — bridge + resolved reads

```text
listResolvedVaults / readResolvedVault
action flags from live + resolved projections
OptionsBridge for CLI/UI
```

### Slice 6 — host indexer (optional)

```text
market index off-chain for cheaper contracts
options read layer switches transport, views unchanged
```

When a feature is documented above but not built in the current phase, keep types stable in `model/`. Gate behavior with clear errors — do not silently ignore unsupported contract fields.

## Relationship To Existing Instructions

This file is the **source of truth for options architecture**: consumer workflow, three-layer state model, runtime/panel pattern, and boundaries with bookmaker/steward/observe/host.

| Document | Role |
| --- | --- |
| `packages/options/docs/architecture.md` (this file) | Options runtime model, ownership, phased delivery |
| `packages/observe/docs/architecture.md` | Media pipeline — complementary pattern reference for runtime/Bridge |
| `host/docs/architecture.md` | Hosted distribution — not options read path for v0 |
| `AGENTS.md` (repo root) | Observe package style; same Effect purity applies here |

### How the layers fit together

```text
contracts (ABI + encode/decode)
  -> options read/ (snapshots)
  -> options project/ (views + panel)
  -> app / cli-re2 (render + wallet write injection)

bookmaker (create) -----> chain
steward (hot/dispute) --> chain
options (consume) <----- chain reads
options (consumer FLOW) <----- token/staking reads + writes
```

### Relationship to `-re`

`-re` (`packages-re/sdk-options`) is a quarry, not a layout template.

Useful to port:

- viem transport patterns from `protocol-viem.ts`, `protocol-transport.ts`
- call naming ideas from `protocol-calls.ts`, `protocol-actions.ts`
- LVST balance/stake/reward calls from `protocol-actions.ts`, rearranged into `read/flow.ts` and `write/flow.ts`

Do not port:

- `CreateVaultParams` / `makeLiveStreakClient` as the public center
- `createVault` ownership into options — that is bookmaker + contracts
- monolithic client that mixes create + consume

When porting, rearrange into the folder shape in this document and drop creation flows from the options public API.

## Verdict

Options should be the next serious package after host types because it becomes the bridge between the UI's prediction market experience and contracts.

Design it as:

```text
browser-safe protocol-state runtime
direct-chain reads for v0
AA/wallet execution injected
in-memory board/panel state
consumer LVST balance/staking/loss-claim actions
no durable hidden storage
no market/vault creation
```

This is the correct shape — consumer read model and workflow, not vault factory.
