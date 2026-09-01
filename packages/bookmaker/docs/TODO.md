# @livestreak/bookmaker — TODO

See [architecture.md](./architecture.md). See [repo TODO](../../../README.md).

**Role:** vault origination under observer-registered `marketId`. Does not create markets. Does not depend on `@livestreak/options`.

---

## Slice A — model + validators

- [x] Pure validators: `BookmakerMarketContext`, `BookmakerWatchSource`, `VaultDraft`, `Detection`, `SimilarityResult`
- [x] `BookmakerDecision` skip reasons typed
- [x] Tests for invalid drafts and policy inputs
- [x] `buildVaultDraft`, `chooseVaultAction`, `projectBookmakerPanel`
- [x] `BookmakerSimilarityClient` interface shape
- [x] `BookmakerWriteIntent` data plan (`createVault`, `joinExistingVault`)
- [x] Public export + architecture guard tests

---

## Slice A.1 — runtime integration boundaries

- [x] `observation/` feed interfaces + `validateObservationEvent` + `buildObservationSubscriptionInput`
- [x] Host similarity types from `@livestreak/host`
- [x] Host adapter mappers — no `host/src` import
- [x] `BookmakerRuntimeConfig` + `validateBookmakerRuntimeConfig`
- [x] Panel polish + JSON serialization boundary test
- [x] Contracts boundary: local `BookmakerContractWriteDescriptor` for `createVault` args (no ABI fragments)
- [x] `joinExistingVault` remains intent-only — no contract join write in v0
- [ ] Blocker: `marketId` string → `Bytes32` encoding helper belongs at execution edge (CLI/contracts), not bookmaker core

---

## Slice B — detection + draft

- [x] Preflight: removed unused `@livestreak/core`, `@livestreak/schema`, `effect`; added `.gitignore`; no `Date.now()` in `src/`
- [x] `PatternDetector`, `PatternDetectionInput`, `BookmakerDetectionPolicy`, `BookmakerDetectionInput`, `BookmakerDetectionEvaluation`
- [x] `detectOpportunity` — confidence threshold, invalid output ignored, detector-order tie-break
- [x] Example detector factories (`createEventKindDetector`, `createPayloadThresholdDetector`) for tests only under `src/detection/factories.ts`
- [x] Pure chain integration test: events → detect → draft → decide → plan
- [x] `buildVaultDraft` requires explicit `nowMs`; `projectBookmakerPanel` uses snapshot time only

---

## Slice C — similarity + decision

- [x] `chooseVaultAction(draft, similarity, policy)` — join | create | skip
- [x] Host client shape for `findSimilar({ marketId, vaultDraft })`
- [x] `findSimilar(draft, client)` async glue + fake host client tests
- [x] No global cross-market similarity enforcement in validators/policy

---

## Slice D — write plan

- [x] `planBookmakerWrite(decision, contracts)` as pure data intents
- [x] No direct ABI fragments
- [x] `createVault` and `joinExistingVault` intents only
- [x] Map `createVault` intent → local `BookmakerContractWriteDescriptor` when `marketIdBytes` supplied
- [ ] Blocker: `@livestreak/contracts` exports wagmi ABIs only — restore public TS write encoders before wiring descriptor mapping to contracts package
- [ ] Wire full write execution via AA transport at CLI edge

---

## Slice E — runtime / Bridge (later)

- [ ] Long-running agent loop — blocked until observation feed execution is owned by CLI/host edge
- [ ] `BookmakerRuntime`, Bridge edge
- [ ] AA execute via injected transport + host bundler

---

## Explicit non-goals

- [x] No `registerMarket` / market creation in write intents
- [x] No user funding streams (options)
- [x] No steward approval gate in v0
- [x] No auto-merge / vault collapse on-chain

---

## Hardening (every slice)

Run after touching this package. Full checklist: [repo TODO § Hardening loop](../../../README.md#hardening-loop).

- [x] check / build / test for `packages/bookmaker`
- [x] Pure-layer tests for validators/decision policy; no `Effect.run*` in `src/`
- [x] Negative-path test for every new public API
- [x] Update this `docs/TODO.md`
