# packages/steward — TODO

See [architecture.md](./architecture.md). See [repo TODO](../../../README.md).

**Role:** accountability workflow — findings, decisions, action plans. TEE is input metadata, not infrastructure here.

---

## Slice A — model + validators (current base)

- [x] Subject types: market, vault, observer, bookmaker, steward, evidence, resolution
- [x] `Finding`, `Decision`, `ActionPlan` types
- [x] Steward-of-stewards as role/ruleset in same package (no separate package)
- [x] `StewardFact` + optional `TeeAttestationRef` metadata
- [x] Validators for subject, finding, decision, action plan

---

## Slice B — rule evaluation (pure)

- [x] `evaluateStewardRules(subject, facts, ruleset) -> Finding[]`
- [x] Facts from contracts reads + host annotations + observe evidence refs
- [x] TEE attestation refs as optional input metadata on facts

---

## Slice C — decision policy (pure)

- [x] `chooseStewardDecisions(findings, policy) -> Decision[]`
- [x] Actions: ignore, annotate, openThread, triggerHot, challenge, resolve, proposePenalty, vetoSteward, challengeStewardDecision

---

## Slice D — action planner

- [x] `planStewardActions(decisions, actionContext) -> ActionPlan[]`
- [x] Contract calls: hot, dispute, resolve, challenge, penalty, veto hooks
- [x] Host call plans: forum thread/message, annotation records (plans only — host stores)

---

## Slice E — runtime / Bridge

- [x] Injected `ContractFactSource`, `HostFactSource`, `ObserveFactSource` interfaces
- [x] `createStewardRuntime` with `refresh`, `readPanel`, `subscribe`, opt-in `startPolling`
- [x] In-memory snapshot; plans handed to injected `StewardActionPlanSink`
- [x] No host/contracts/observe value imports in `src/`
- [ ] Bridge wiring at CLI/app edge (real readers + plan sink)
- [ ] No market/vault creation, no user streaming

**Runtime gate (edge):** CLI/app must inject real contract/host/observe fact readers and an action-plan sink that submits to bridge/contracts/host. The package defines interfaces + loop only.

---

## Explicit non-goals

- [x] No bookmaker creation approval gate in v0
- [x] No forum storage (host)
- [x] No TEE runtime in this package

---

## Slice F — hardening (typed plans + test typecheck)

- [x] `tsconfig.build.json` for `src` emit; `tsconfig.json` typechecks `src` + `test`
- [x] Typed `StewardContractCall` discriminated union (`vault`, `stewardRegistry`)
- [x] Typed `StewardHostAction` payloads (`openThread`, `appendMessage`, `annotate`)
- [x] Strict action-plan validators with negative-path tests
- [x] Fact/TEE validation polish (finite timestamps, non-empty evidence refs)

---

## Active Cleanup — post-hardening hygiene

> Resolved 2026-06-15 (2nd attempt): re-verified from source — all four validator holes
> closed (fact/finding `[]` + empty-string refs, finding `createdAtMs` finite, TEE requires
> a real reference field). Negative tests added; 60 tests pass (confirmed locally). Done.

- [x] Tighten fact/finding evidence refs: present arrays must be non-empty with non-empty strings
- [x] Tighten finding timestamps: `createdAtMs` must be finite
- [x] Tighten TEE metadata: attestation refs need at least one real reference field
- [x] Remove ignored local junk (`dist/`, `node_modules/`, `.DS_Store`) if untracked
- [x] Verify local package scripts directly, not only root workspace scripts
- [x] Confirm public exports stay pure/product-facing

---

## Hardening (every slice)

Run after touching this package. Full checklist: [repo TODO § Hardening loop](../../../README.md#hardening-loop).

- [x] check / build / test for `packages/steward`
- [x] `tsconfig.json` typechecks `test/`; `tsconfig.build.json` builds `src/` only
- [x] Typed `StewardContractCall` and `StewardHostAction` payloads (no loose strings)
- [x] Stricter fact/TEE metadata validation
- [x] Pure rule/decision tests; no `Effect.run*` in `src/`
- [x] Negative-path test for every new public API
- [x] Update this `docs/TODO.md`
