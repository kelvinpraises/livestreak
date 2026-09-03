# Host — module flows (redraw target)

Cross-substrate permissionless provider node. **One capability = one folder = one descriptor token.**
`server/` mounts only enabled modules. Walrus/MemWal is the storage + memory substrate; bespoke
forum/cache DBs are retired in favor of namespace-scoped `remember`/`recall`.

Design laws (always):

1. **Design OUTWARD** — fix seams at the owning package; host does not translate mismatched app URLs.
2. **STOP + NOTIFY** — source-fixable blockers get inbox requests, not host-side papering.

## Module status

| Module | v0 | Notes |
| --- | --- | --- |
| `descriptor/` | **LIVE** | identity, capability advert, chains, relayer/media URLs, `/health` |
| `aa/` | **LIVE** (seam broken) | multi-chain bundler + ERC-7677 paymaster; boot-assert signer |
| `media/` | **LIVE** flow, **STUB** provider | policy → session → signed manifest → watch/simulcast URLs |
| `discovery/` | **LIVE** | vault similarity index + find (bookmaker dedup, steward grouping) |
| `memory/` | **STUB** | MemWal relayer advert + namespace-per-market passthrough |
| `runtime/` | **STUB** | TEE agent hosting (Nautilus pattern) |
| `tenancy/` | **STUB** | accounts / api-keys / quota (delegate to MemWal relayer gating) |

---

## Identity bridge (implemented)

```text
host-private (memory/ internal state — NEVER serialized to descriptor or route responses):
  MarketMemoryBinding {
    marketId:        string        // EVM bytes32 string — the ONLY external key
    memWalAccountId: SuiObjectId   // internal; shared per-market MemWalAccount object
    namespace:       string        // "market:{marketId}"
  }

public descriptor.memory (global-safe — chain-agnostic, no Sui internals):
  { relayerUrl: string|null, namespaceTemplate: "market:{marketId}", trustModel: MemoryTrustModel }

broker route:
  POST /memory/access { marketId, suiDelegate } ->
    resolve binding internally (lazily provision if absent) ->
    grant suiDelegate on the account ->
    return { relayerUrl, namespace }      // NEVER returns memWalAccountId
    until relayerUrl configured -> 503 memory_relayer_not_configured
```

`MemoryTrustModel = "plaintext-relayer" | "client-encrypted" | "tee-attested"` (demo: `plaintext-relayer`).

---

## `descriptor/`

**Expands:** discovery — clients/agents learn what this node provides before connecting.

### Stage A — `GET /health`

| | |
| --- | --- |
| Ideal | `{ ok: true, hostId?, version?, uptimeMs? }` |
| Caller injects | nothing |
| HANDLED | process up |
| UNHANDLED | — |
| STUB | — |

### Stage B — `GET /descriptor`

| | |
| --- | --- |
| Ideal | `HostProviderDescriptor` + **enabled module tokens** (`aa`, `media`, `memory`, `discovery`, …), `supportedOutputs`, `media.simulcastAvailable`, `memory` advert (no Sui object id) |
| Caller injects | host operator config at boot (`@livestreak/schema` shapes, not baked literals) |
| HANDLED | static advert from config |
| UNHANDLED | hot reload of capabilities without restart |
| STUB | hot reload of capabilities without restart |

Module registry is **LIVE** in `server/registry.ts` + `server/modules.ts`.

### Stage C — `GET /aa/descriptor`

| | |
| --- | --- |
| Ideal | per-chain EntryPoint, Safe module, `bundlerPath`, `paymasterPath`, sponsorship mode |
| Caller injects | AA chain config (shared with app `EvmWalletInitConfig`) |
| HANDLED | single-chain `local` route key today |
| UNHANDLED | multi-chain list matching app Mantle 5003 |
| STUB | — |

**Source-fixable blocker (STOP):** app `walletConfig()` uses `localhost:4848/bundler/mantle` (chain 5003); host serves `8787/aa/bundler/local` (chain 31337). No host-side URL translation — inbox **app + contracts**.

---

## `aa/`

**Expands:** gasless UserOps — viewers/observers/agents cannot self-fund every chain.

### Stage A — boot

| | |
| --- | --- |
| Ideal | load per-chain `{ rpcUrl, entryPoint, paymasterAddress, executorPrivateKey }` from env; `bootstrapAaFromConfig()` spawns Alto; **assert** `privateKeyToAccount(executorKey).address === onChainVerifyingSigner` |
| Caller injects | deploy output + `OPERATOR_ADDRESS` / executor key |
| HANDLED | Alto spawn + paymaster signer when env present |
| UNHANDLED | boot assert signer == `LiveStreakPaymaster` verifyingSigner (`05-paymaster.ts:33`) |
| STUB | — |

### Stage B — `POST /aa/bundler/:chain`

| | |
| --- | --- |
| Ideal | JSON-RPC proxy to local Alto port for that chain |
| HANDLED | 503 JSON-RPC when Alto not running; proxy when up |
| UNHANDLED | remote Alto / production bundler URL |
| STUB | — |

### Stage C — `POST /aa/paymaster/:chain`

| | |
| --- | --- |
| Ideal | ERC-7677 `pm_getPaymasterStubData` / `pm_getPaymasterData` |
| HANDLED | stub + sign paths; -32601 unknown method |
| UNHANDLED | sponsorship policy (`tenant_quota`), ActionPlan execution edge |
| STUB | — |

### Edge matrix

| Edge | Status |
| --- | --- |
| chain route key missing / unknown | 503 JSON-RPC **HANDLED** |
| signer key ≠ on-chain verifyingSigner | **UNHANDLED** (must boot-fail) |
| paymaster deposit exhausted | **UNHANDLED** (chain revert at execution) |
| replay / cross-chain id mismatch | **UNHANDLED** (caller must pass correct `chainId` in pm_getPaymasterData) |
| unauthorized sponsorship | **STUB** (tenancy off; MemWal-style gating deferred) |

---

## `media/` (fold: `sessions/` + `manifests/` + `policy/` + `webrtc/`)

**Expands:** observer scale-out — local machine cannot simulcast to thousands; host ingests and returns watch link for on-chain registration.

**Walrus design-out:** cache receipts become memory/evidence refs on Walrus; not a separate quota DB long-term.

### Stage A — policy gate (`POST /media/policy/evaluate`)

| | |
| --- | --- |
| Ideal | evaluate `outputMode`, cache intent, duration, quota **before** session |
| Caller injects | `HostPolicyRequest` |
| HANDLED | unsupported output, cache quota, `simulcast` capability checks (`simulcast_unavailable` when LiveKit absent) |
| UNHANDLED | LiveKit quota / api-key gate beyond on/off |
| STUB | — |

**Invariant:** policy evaluation remains a **distinct stage** inside `media/`; `evaluateHostPolicy` runs before manifest assembly in session create.

### Stage B — session + manifest (`POST /media/sessions`, `GET /media/sessions/:id/manifest`)

| | |
| --- | --- |
| Ideal | policy pass → mint `HostSessionDraft` → assemble + **sign** `EndpointManifest` → return endpoints |
| Caller injects | `sessionId`, `contentId`, `observer`, `outputMode` (observe supplies; host does not invent) |
| HANDLED | in-memory session + dev manifest with `watch` + `webrtc` URLs |
| UNHANDLED | real manifest crypto signature (`dev-stub-signature:…` today) |
| STUB | LiveKit room creation; `createLiveKitMediaProvider` returns 503 `media_provider_not_configured` when `LIVEKIT_API_KEY` absent |

**Manifest ownership (observe seam):**

| Field | Owner |
| --- | --- |
| `sessionId` | **caller** (observe `runId` — proposed 1:1) |
| `contentId` | **caller** (observe-derived, e.g. hash of capture config + runId) |
| `observer` | **caller** (EVM address or agent id string) |
| `endpoints[].url` (public watch/webrtc) | **host** synthesizes after provider bind |
| `hostId`, `hostPolicyStatus`, `signature`, `expiresAtMs` | **host** |
| raw sink URI before forward | **observe** supplies via publication projection (not in host lib) |

Kinds observe originates: raw capture sink location (internal). Kinds host synthesizes: `watch`, `webrtc` (forwarded). Host may add: `state`, `telemetry`, `archive`, `control`.

### Stage C — provider bind (LiveKit)

| | |
| --- | --- |
| Ideal | ingest observer stream → simulcast → return viewer URL |
| STUB | `webrtc/forwarding.ts` dev passthrough; LiveKit adapter behind `MediaProvider` interface |
| UNHANDLED | provider-down, room quota exceeded |

### Stage D — cache receipt (`POST /media/sessions/:id/cache-receipts`)

| | |
| --- | --- |
| Ideal | accept evidence ref → append to manifest → Walrus blob pointer |
| HANDLED | in-memory receipt + manifest ref |
| STUB | Walrus upload; becomes `memory/` evidence write |

### Edge matrix

| Edge | Status |
| --- | --- |
| policy blocks session | 400 **HANDLED** |
| duplicate sessionId | 409 **HANDLED** |
| manifest expired mid-stream | **UNHANDLED** (rotation / `key_rotation` capability) |
| outputMode `simulcast` without LiveKit | **HANDLED** → policy `simulcast_unavailable` (400) |
| LiveKit down / unconfigured at bind | **HANDLED** → 503 `media_provider_not_configured` at provider |
| unauthorized observer | **STUB** (tenancy off) |

---

## `discovery/` (from `similarity/`)

**Expands:** vault dedup inside a market — chain does not dedup (e2e #7).

### Stage A — `POST /discovery/vaults`

| | |
| --- | --- |
| Ideal | dev index; production: chain `VaultCreated` indexer |
| HANDLED | in-memory index |
| UNHANDLED | chain-event indexer replaces open route |

### Stage B — `POST /discovery/find`

| | |
| --- | --- |
| Ideal | `BookmakerSimilarityClient.findSimilar` → host HTTP client |
| Caller injects | `{ marketId, vaultDraft }` |
| HANDLED | token overlap scoring |
| UNHANDLED | steward grouping client (same engine, different caller) |
| STUB | future semantic recall via MemWal |

---

## `memory/` (fold: `forum/` + `cache/` durable layer)

**Expands:** steward coordination across laptops — shared namespace-scoped memory.

### Stage A — descriptor advert

| | |
| --- | --- |
| Ideal | `memory.relayerUrl` + `namespaceTemplate` (`market:{marketId}`) + `trustModel` in descriptor — **no Sui object id** |
| HANDLED | descriptor `memory` block when module enabled |

### Stage B — `POST /memory/access` (broker)

| | |
| --- | --- |
| Ideal | lazy provision per-market `MemWalAccount`, grant `suiDelegate`, return `{ relayerUrl, namespace }` |
| HANDLED | in-memory binding store + broker route |
| STUB | real MemWal relayer provisioning; returns 503 when `memoryRelayerUrl` unset |
| UNHANDLED | self-hosted relayer deployment |

### Forum retirement

`forum/` CRUD → **deleted**; steward `open_forum_thread` becomes `memory.remember` with structured payload.

### Edge matrix

| Edge | Status |
| --- | --- |
| relayer down | **STUB** 503 |
| namespace not configured | **STUB** |
| cross-substrate owner mapping (EVM steward → MemWal delegate) | **UNHANDLED** — see adversarial §1 in report |
| plaintext at relayer | **UNHANDLED** trust boundary — see adversarial §2 |

---

## `runtime/` (STUB)

TEE agent hosting for steward/bookmaker. Descriptor token present; routes return `501 runtime_not_enabled`.

---

## `tenancy/` (STUB)

MemWal relayer already ships delegate-key auth + cost-weighted rate limits. Host documents env to enable; does not reimplement. Routes return `503 tenancy_not_configured` when off.

---

## `server/`

HTTP shell: `readJsonBody`, `matchRoute`, `dispatchHttpRequest`, module DI via `createHostRouteDeps`, capability registry (target: mount only enabled modules).

**Current routes (14):** `/health`, `/descriptor`, `/aa/descriptor`, `/media/policy/evaluate`, `/media/sessions`, `/media/sessions/:id/manifest`, `/media/sessions/:id/cache-receipts`, `/discovery/vaults`, `/discovery/find`, `/memory/access`, `/aa/bundler/:chain`, `/aa/paymaster/:chain`, plus stub catch-alls for `/runtime/*` and `/tenancy/*` (501).

Legacy paths (`/sessions/*`, `/similarity/*`, `/forum/*`, `/policy/evaluate`) return **404** — no aliases.

---

## Cross-package dependency graph

```text
observe ──publication facts──▶ media (session + manifest)
app/wallet ──EvmWalletInitConfig──▶ aa (bundler + paymaster URLs must match)
bookmaker ──findSimilar──▶ discovery
steward ──remember/recall──▶ memory (MemWal relayer)
contracts ──VerifyingPaymaster.signer──▶ aa boot assert
```
