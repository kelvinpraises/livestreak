# @livestreak/observe — TODO

See [architecture.md](./architecture.md). See [repo TODO](../../../README.md).

**Mode:** backbone (contracts + host + AA register) is LIVE; CLI producer-edge is built. observe's remaining v0 work = expose the `goLive`/`setEnded` lifecycle writes + the consumer read split. observe stays pure **outside** `market/chains/**`; all chain/wallet I/O lives under `market/chains/**`.

---

## Status — backbone DONE

**Done & verified:**
- contracts `MarketRegistry`: `registerMarket`, `streamState`(`goLive`/`setEnded`/`isLocked`, creator-gated), `StorageScheme` enum — `forge test` 136/0, commit `9787abe`.
- host content-store **LIVE**: `POST /content/blobs {bytesBase64, persistence}` → `StorePointer{scheme,id,url}`; `GET /content/blobs/:scheme/:id`. Proven on testnet. Types in `@livestreak/host` (`StorePointer`, `PointerScheme`, `ContentPersistence`) — import, never redefine.
- host media-sessions: live endpoints host-synthesized + host-signed (dev-stub).
- observe Slice 1 (market registration edge): AA register, local `marketId`, `market` board cell, idempotent, non-blocking.
- CLI producer edge (R1, `livestreak produce`): loads `livestreak.json`, runs observe, uploads MP4 to host, reads `marketId` off the board cell + mp4 off the file sink.

**Locked decisions:**
- `streamId = keccak256(abi.encode(observer, runId))` — observe-owned, helper is single source of truth.
- key by `marketId`; output mode `simulcast` (`forwarder` deleted). v0 = chain points **directly at the VOD blob**; a manifest is phase 2 (live).
- `(scheme, id)` on-chain — `id` is a **`string`** held verbatim, 1..64 bytes (a `bytes32` can't hold an IPFS CID), **no encode/decode**. scheme order `0 walrus-testnet · 1 walrus-mainnet · 2 ipfs · 3 arweave` (cross-package, fixed; same order as host's `PointerScheme` literals).
- the on-chain lifecycle writes (`goLive`/`setEnded`) belong to **observe**, not the CLI (CLI is a pure router). observe owns the market, so it owns the market's lifecycle. Accepted from cli `from-cli__expose-setended`.

---

## Stream lifecycle / media discovery (the e2e loop)

**Model (v0):** `marketId → current media` via ONE keyed on-chain read (`streamState(marketId)` → `status, scheme, id`). In v0 `(scheme,id)` points **directly at the VOD blob** — NO manifest, NO signature (the creator-gated tx IS the attestation; `id` is a content hash → tamper-proof). Chain = source of truth; observe = pure outside `market/chains/**`; CLI = orchestration; host = store/serve.

### Init doc — CLI-owned (`livestreak.json`)
The edge bootstrap file lives in the CLI working dir and the **CLI owns it** (loader + evolving `run` cache; the secret seed is injected at runtime, never serialized). Recorded here only because observe feeds it — observe surfaces `marketId` on the `market` board cell and the CLI caches it. `run` never overrides chain (`streamState(marketId)` is truth). Shape (FYI):
```json
{
  "chain":  { "rpc": "..", "marketRegistry": "0x..", "chainId": 0 },
  "host":   { "url": "https://..", "walrusNetwork": "testnet" },
  "wallet": { "config": {}, "seedRef": ".." },     // producer only; seed at runtime
  "run":    { "runId": "..", "streamId": "0x..", "marketId": "0x..", "status": "none|live|ended" }
}
```

### Producer flow (v0 file→VOD)
```
CLI loads livestreak.json
CLI → run observe { title, walletInit, seed, marketRegistryAddress, runId }
        observe FORKS registerMarket (AA; creator = the Safe) + records MP4 (file sink)
CLI reads marketId (market board cell) + mp4 (file-sink path)
CLI → POST host /content/blobs {mp4,"locked"}   → vodPtr {scheme,id,url}
CLI → observe.goLive(marketId, scheme, id)      observe write op (creator Safe)
CLI → observe.setEnded(marketId, scheme, id)    observe write op (creator Safe)
```
No manifest / no buildManifest in v0. `id` = verbatim string. `goLive` before `setEnded` (contract `None→Live→Ended`). Both writes use the SAME creator Safe as `registerMarket` (creator-gated, else `"not creator"`).

### Consumer flow (v0)
```
read streamState(marketId) → status, scheme, id   options: readStreamState (raw pointer)
resolve gateway(scheme) + id → VOD url            app (v0 app-level; no manifest hop)
GET VOD url → play
integrity = content-addressed id + creator-written pointer (no sig)
```

### Build list
- [x] `observeRunStreamId(observer, runId)` helper + neg-test — **DONE** (golden vector cast-verified; 433 tests)
- [ ] **observe lifecycle writes** — `createMarketLifecycle(config) → { goLive, setEnded }`, wallet-direct under `market/chains/**`, same creator Safe as `registerMarket`, `scheme` as `uint8`. Accepted from cli (`from-cli__expose-setended`); prompt queued at `context/temp-convo/prompts/observe.md`; CLI then routes to it + deletes its TEMP write.
- [ ] consumer: **options** = `readStreamState(marketId)` (raw pointer, contract I/O only); **app** resolves `scheme+id → gateway url` + plays (v0 app-level, no manifest). options confirmed this split.
- [ ] (forward-thinking) brand `userOpHash` → opaque `TxId` on `MarketRegisterResult` **and** `MarketLifecycleWriteResult` (chain-agnostic for Sui; AA poll stays in `chains/evm`) — per options shared-patterns

> init doc (`livestreak.json`) loader/cache is **CLI-owned** — nothing to build here; observe only surfaces `marketId` on the board cell.

---

## Phase 2 — live
- [ ] simulcast sink (live network output) under `pipeline/publish/sinks/simulcast/`
- [ ] live manifest + `goLive` re-point — decide HLS vs WebRTC. Manifest is content-addressed, **no `sig`** (creator-gated `goLive`/`setEnded` = attestation; `id` = content hash; EIP-1271 / canonical-JSON signing killed). Shape: `{ streamId, status, title, thumbnail, startedAt, endedAt, vod:{ scheme, id, url, durationMs } }`. Live endpoints stay host-signed (host's concern).

## Endgame — settle
- [ ] stream-end → market-close signal keyed to `marketId`; contracts likely needs `closeMarket`/`settleMarket`
- [ ] `subjectRef` / subject metadata (no `subject` concept today — needs design)

---

## Progress
- Backbone (contracts + host + AA register) + CLI producer edge: **done**.
- e2e VOD demo (the loop above): **~70%** — backend + producer edge done; observe lifecycle writes (prompt queued) + consumer read remain. No hard crypto.
- Full product (incl. live + settle): **~45%**.

---

## Future pipeline slices
- [ ] IPTV capture `pipeline/capture/iptv/`
- [ ] Football process pack `pipeline/process/football/`

## Hardening (every slice)
`check / build / test / lint` green; no `Effect.run*` in `src/`; wallet/viem/`@livestreak/contracts` only under `market/chains/**`; no baked secrets; no empty files.
