# Agent control contract (flow 01)

One role session, driven by an outside process. The signer never leaves the
local gateway.

## Install

Requires Node 22+. The published artifact bundles its workspace
dependencies, so a clean install has no `file:` lookups:

```sh
npm pack @livestreak/cli          # in a checkout, or npm view for the version
npm install --no-save ./livestreak-cli-0.1.0.tgz   # in a CLEAN directory
npx livestreak --help
```

`dist/main.js` and `dist/agent-client.js` are esbuild bundles built by
`cli/scripts/bundle.mjs`: every `@livestreak/*` workspace import is inlined;
only published deps (`@effect/*`, `effect`, `viem`, `ws`, `sodium-universal`)
stay external. `esbuild` is a pinned CLI devDependency. One ESM shim
(`cli/shims/noble-cryptonode.mjs`) stands in for noble-hashes v1 CJS
`cryptoNode.js`, which a bundler cannot emit into ESM output.

## Sessions

```sh
# Operator (keeps the seed locally, shares ONLY code+pass):
livestreak remote open --scopes bridge:board:read,bridge:action:fund --ttl 30m
# pairing code: <sessionId>   pairing pass: <pairingPassword>

# Outside consumer — read catalog + boards (password via file or env;
# `--pair-password` also works but lands in shell history):
export LIVESTREAK_PAIR_PASSWORD="<pairingPassword>"  # or --pair-password-file ./pair.txt
livestreak remote board --session <sessionId> \
  --host-url http://127.0.0.1:8787

# Outside consumer — one permitted action (args as JSON):
livestreak remote call --session <sessionId> \
  --target options --action fund --args-json '{"tokenId":"7","vaultId":"0xvault","side":"yes","rate":"1000","deposit":"1000000"}' \
  --host-url http://127.0.0.1:8787

# Operator revokes:
livestreak remote revoke --session <sessionId>
```

## Bot-fed ingest drive (media-only)

One outside same-host process drives a bot-fed broadcast through the packed entry:

```ts
import { createAgentClient, runRemoteDrive } from "@livestreak/cli/agent-client";
```

Types ride alongside from the same path (`RemoteDriveInput`, `IngestPump`,
`IngestPumpError`); the tarball's declarations are self-contained — no workspace
imports for a clean consumer to resolve.

The grant needs `bridge:action:captureKind` next to the configure/publish/`goLive`/
fund scopes:

```ts
await runRemoteDrive({
  sessionId, pairingPassword, hostUrl,
  // Supply your complete judging terms; only bind the freshly registered market ID here.
  mandateForMarket: (marketId) => ({ ...authoredMandate, marketId }),
  operationId: creationOperationId, // nonzero 0x + 64 hex; reuse for recovery
  ingest: {
    width: 640, height: 360, fps: 30,
    port: 48710, path: "/frames", // server defaults; the bot chose them
    frames: myShowFrames(), // AsyncIterable<Uint8Array>, exact bytes per contract
  },
  mediaOnly: true, // vault + fund + re-probe, then return — no steward legs
});
```

- Contract: each frame must be exactly `width×height×4` bytes (rgba; the server
  default — a board-preset `yuv420p` takes `width×height×3/2`). Wrong sizes get
  HTTP 400, a full queue gets 429 (the pump slows down), anything else surfaces
  with posted/dropped counts.
- Order: `captureKind → publishKind(direct) → configure → publish → prepare →
  start → POST → watch proof → goLive → vault/fund → re-probe → return`.
  Without the `publishKind` switch the direct configure lands on the live surface
  and no door is announced. No circular wait: the bot
  chose the endpoint and retries POSTs until the server listens; the drive waits
  only on viewer bytes.
- Pump ownership: the returned `result.pump` (or `IngestPumpError.pump` on
  post-start failure) is still posting under YOUR ownership — stop it after
  truthful end. The drive stops it only on pre-live registered failures.
  `pump.exhausted()` reports a naturally ended supply; a hung iterable cannot
  stall teardown.
- Proof frames for A's own verification come from `generateCounterFrames`
  (labeled proof-only); an external show bot supplies frames over the same input.
- Failure rules match the file lane: pre-live asks for a stop and reports
  registered-not-live; uncertain `goLive` keeps media for readback; post-live
  failures carry `lastVerifiedMedia` and never claim a rollback; flow-06 owns stop.

## Release verification

The checked-in probe packs, installs, imports, typechecks and lock-checks the
release exactly as Master does:

```sh
node cli/scripts/verify-clean-consumer.mjs   # from the repo root
```

`cli/test/packed-entry.test.ts` pins the same surface in-suite: the built bundle
loads as ESM with exactly the advertised exports, and the shipped declarations
match the source both ways at typecheck time.

## Programmatic use

```ts
import { createAgentClient } from "@livestreak/cli/agent-client";

const client = createAgentClient({
  hostBaseUrl: "http://127.0.0.1:8787",
  sessionId: "<sessionId>",
  pairingPassword: "<pairingPassword>"
});
await client.connect();
console.log(client.functions()); // scope-filtered catalog
console.log(client.boards());    // latest board patches
const out = await client.call("options", "fund", { /* ... */ });
client.close();
```

## Error contract

- `scope-denied: …` — grant is live but the action is outside its scopes.
  Nothing was dispatched (no `result.txId`/`tokenId`).
- `revoked-or-expired: …` — grant revoked by the operator/host or past
  `expiresAt`. The client latches revocation: pending calls fail with this
  (not `connection closed`), later calls on the same grant stay revoked, and
  an expired grant fails before anything is sent. Reconnecting with the same
  grant never regains access.
- `not connected` / `connection closed` — transport loss without revocation.
  Reconnect and reconcile before retrying money-moving calls.
- Anything else — transport/chain failure; reconcile before retrying
  money-moving calls (never blindly repeat).

Credentials never appear in outputs or test receipts: missing-credential
errors name the flags, never the secret.

## Probe

Offline (`cli/test/agent-control.probe.test.ts`) always runs: classifier
checks, catalog capture, denial-without-ledger, revoked-pending and
expired-guard behavior against a fake Host, plus credential redaction.

Live (needs a real Host + a THROWAWAY session — the revoke step destroys it).
Use the installed Node 22 binary (`.../node/v22.13.0/bin/node`); the bundled
SQLite binding is ABI 127 and does not load under Node 26. No rebuild needed.
Verified 2026-09-25 via throwaway real Host (in-memory DB) + gateway stub +
shipped `createAgentClient`: catalog `["fund"]`, permitted `fund` ok with
`txId 0xproof` and gateway dispatch 1, denied `resolve` → `scope-denied:`
with dispatch still 1 (no forward), gateway `revoke` → next call
`revoked-or-expired: session revoked by host` (distinct from transport loss).

```sh
livestreak remote open --scopes bridge:board:read --ttl 30m   # operator
LIVESTREAK_AGENT_PROBE=1 \
LIVESTREAK_PROBE_HOST=http://127.0.0.1:8787 \
LIVESTREAK_PROBE_SESSION=<throwawaySessionId> \
LIVESTREAK_PROBE_PAIR_PASSWORD=<pairingPassword> \
LIVESTREAK_PROBE_CAN_REVOKE=1 \
npm test --workspace=cli -- agent-control.probe
```

No-dispatch check: the gateway logs the denial; nothing reaches chain
(the probe asserts `ok:false`, a `scope-denied` message and no result ids).

## Real-gateway role proof

Checked in as `cli/test/remote-role-proof.test.ts` (needs Node 22) with its
outside driver `cli/test/fixtures/remote-controller.mjs`. One file boots a real
Host and a real gateway (registry, relay, merged dispatch over real console
edges; real seed and wallet init plus a fixed test address, localhost settings)
and drives them from a SEPARATE process: the fixture is COPIED into the clean
consumer and launched there, and each run asserts the reported module URL
resolves inside the installed tarball (never back into the repo). It proves: a
permitted board-only observe `configure` lands with exactly one dispatch (read
back as a structural `system:config.readonly.observations` entry with
title+chain, no chain-tx-shaped result); an out-of-scope call fails
`scope-denied` with zero gateway-inbound frames and zero dispatches (Host relay
and gateway registry checked independently); the operator revoke path ends a
pending call AND a second call on the same client with exactly
`revoked-or-expired` (no added dispatch), and rejoin is rejected; a SIGKILLed
call reconciles to one dispatch plus matching board state. Bounded waits,
tracked children, gate release and Host DB close in teardown.
Unproven here by design: chain writes (localhost RPC is dead; only board-safe
actions run), the stock example, live-network behavior, and the wallet-address
constant consumed solely by undispatched lanes (a live bundler would be needed
to derive it). This file alone does not complete Flow 01.

Resume/reconnect semantics are flow 08 and explicitly out of scope here.

## Rule-bound creation and independent reads (Flow 03)

Creation requires the complete generic `livestreak-mandate/1` document and a nonzero bytes32 operation ID. The Bookmaker form accepts mandate JSON text; programmatic `createVault` accepts an object or JSON text. Terms are published before creation, and the EVM vault stores their immutable SHA-256 commitment and funding close. The operation ID belongs to the creator: repeat identical inputs for recovery; changed inputs reject.

Viewer and Steward sessions independently call `readMandate` with `{ vaultId }`. Successful replies contain `{ terms, mandate }`, verified against chain metadata. Creation replies contain `{ txId, tokenId, commitment }`, where `tokenId` is the vault ID. These fields survive the Host/gateway wire and the self-contained public declarations. Fund/lane/top-up writes refuse unavailable or mismatched terms and use chain time for cutoff checks; safe stops remain available without rule storage.

The drive API accepts explicit `mandate` or `mandateForMarket(marketId)` plus `operationId`; it does not infer judgement from the stream title. The CLI drive accepts `--mandate-file` and `--operation-id` for explicit terms bound to the intended market. For the demonstrated four-role live-media path use [the RTMP integration example](../../examples/rtmp-broadcaster/README.md). Its Viewer/Steward credentials are test orchestration, not production bot permissions.

Support is local EVM with the Flow03 contract/ABI version. Contract/ABI source commits remain held by the user; this SDK packet alone is not a deployable feature release. Legacy EVM and unsupported Solana/Sui bound writes never fall back to question-only vaults. Resolution, payout and public Solana remain later flows.
