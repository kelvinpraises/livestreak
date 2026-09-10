# Remote Bridge Console — host ⇄ gateway ⇄ browser

The Remote Bridge Console lets a remote operator drive a creator's bridge (fund, set lanes, …) from a
browser, **without the browser ever holding the seed**. The host is a verifying relay; the CLI gateway
is the only signer; the app is an auto-rendered console.

```
[browser app]  ⇄ leg B (WSS) ⇄  [HOST relay+verifier]  ⇄ leg A (WSS) ⇄  [cli gateway]  → owning bridge
 redeem/connect/send                serves /remote, mints+verifies            keystore(seed), authorizes,
 renders functions[]                grants, scope-checks, relays              dispatches with the seed
```

## One canonical protocol

All three ends import the SAME frame types from **`@livestreak/schema` (`remote-protocol.ts`)** — the
per-package copies were deleted. Leg A (gateway⇄host): `register` / `call_result` / `board_patch` /
`revoke` ⇄ `ack` / `call` / `session_closed`. Leg B (browser⇄host): `ui.hello` / `call` ⇄ `ready` /
`functions` / `call_result` / `board_patch` / `revoked` / `error`. `call_result.error` is an object
`{code?, message}`; `session_closed.reason` ∈ `ttl_expired | revoked | gateway_down`.

## Scope model

Authorization is on the GRANULAR console scope `bridge:action:<action>` (writes) and `bridge:board:read`
(reads) — the model the gateway already enforces. Each package's internal catalog scope (e.g. options'
`options:vault:fund`) is normalized to `bridge:action:<name>` at the gateway projection boundary, so
console authz is uniform and package-agnostic. The operator grants e.g. `bridge:action:fund` (one action)
or `bridge:action:*` (all). The depth-guarded matcher in `@livestreak/schema/capability` authorizes.

## Admission & secrets

- The operator shares a **pairing password** (separate from the keystore password). The gateway sends only
  its scrypt **verifier** (`scrypt$<salt>$<hash>`) to the host on `register`; the host verifies
  `POST /remote/:session/join` against it and never sees the plaintext.
- `/join` returns a **host-signed** `CapabilityGrant` (Ed25519 grant key — never the paymaster key). The
  browser presents it on `ui.hello`; the relay verifies the signature, session binding, scope, and replay
  on every call.
- The **seed never crosses any leg**: the gateway dispatches to the seed-bound bridge inside a closure and
  runs every outbound frame through a seed-safety guard.

## Stand up the channel

```bash
./dev-remote.sh                 # anvil + host (remote enabled, LIVESTREAK_APP_ORIGIN set) + app
# second terminal:
cd cli && npm run dev -- remote open --scopes bridge:action:fund --ttl 10m
#   → prints: pairing code, pairing pass, the /remote/<code> URL after the host ack
# browser: open http://localhost:3000/remote/<code>, enter the pairing pass.
```

Set `VITE_REMOTE_HOST_URL=http://127.0.0.1:8787` for the app to use the real `HostWssTransport` instead of
the in-process mock. Set `LIVESTREAK_REMOTE_GATEWAY_TOKEN` (host) + `LIVESTREAK_GATEWAY_TOKEN` (cli) to
require leg-A gateway auth.

## Proven (automated)

- **Protocol round-trip** — every canonical frame JSON round-trips and is classified by one leg guard
  (`packages/schema/test/remote-protocol.test.ts`).
- **Real 3-way relay over sockets** — gateway `register` (with a `functions[]` catalog) → `ack`; browser
  `ui.hello` → `ready` whose `functions[]` are **grant-filtered server-side** (only in-scope `fund`
  survives; `withdraw` filtered out); `call` → relayed → `call_result`; unknown-session UI upgrade
  rejected (`host/test/remote-wss.test.ts`).
- **Host relay scope-deny / replay / isolation / signed-grant** (`host/test/remote.test.ts`).
- **Gateway authorize + spend-cap, seed-absence guard** (`cli/test/gateway-relay.test.ts`); scope
  normalization + filtering (`cli/test/gateway-console-functions.test.ts`).
- **Leg-B `HostWssTransport`** redeem → connect → `ready(functions)` → `send` → `call_result` +
  `board_patch`; wrong password → 401 (`app/test/host-wss-transport.test.ts`).

The only manual step is flipping a **real browser** at `/remote/<code>` — the keynote moment, not
automatable here.

---

## E2E success criteria (go-live keynote)

**Canonical scope:** `docs/GO-LIVE-SCOPE.md`. This section is the host-facing summary.

### Product path (board-first — no `produce`)

```
settings init → auth login → remote open
→ browser /remote/<code> unlock
→ Observe: configure → market.register → copy marketId from board
→ Options: configure(marketId) → setApprovalForAll → fund
→ Steward: resolve
→ Options: withdraw / claim
```

The CLI gateway relays `call` / `board_patch` per package (`target=observe|options|steward|bookmaker`).
The seed never leaves the gateway process.

### Agent-5 hard gates

| Check | Pass |
|-------|------|
| Pairing unlock + WSS `open` | Remote session live |
| Observe T0 board | Only `system:config` until `configure` |
| After configure | Pipeline cells + `market.register` available |
| `market.register` | Board shows `marketId` |
| Options fund | On-chain userOp after manual `marketId` paste |
| Steward resolve + Options settle | Completes lifecycle |

### Preflight (not remote UI)

- Regenerate `settings.json` after `./dev.sh` force deploy (addresses change)
- Mint test USDC to operator Safe via `cast` (see `host/docs/dev-stack.md`)
- On `ExecutionFailed 0xacfdb444`: `cast run <userOpHash>` for inner revert

### Soft / deferred

- **S4 live WebRTC** — host `/webrtc/signal` exists; app consumer is agent-1; watchUrl/VOD OK for agent-5
- **Bookmaker tab** — optional; not required for minimal keynote
- **Headless automation** — agent-3 remote driver uses same WSS relay as browser

### Do not

- Restore `produce` as canonical path
- Auto-inject `marketId` across app tabs
- Use `LocalMockTransport` for remote proof
