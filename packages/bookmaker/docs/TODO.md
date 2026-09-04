# @livestreak/bookmaker — TODO

See [architecture.md](./architecture.md) and [flow.md](./flow.md).

**Role:** in-package vault executor under observer-registered `marketId`. Does not register markets. Does not depend on `@livestreak/options`.

---

## Slice 1 — in-package multichain executor

- [x] `chains/` EVM writer + Sui stub
- [x] `flows/originate.ts`, `runtime/`, `bridge/`
- [x] `createHostDiscoveryClient` → `POST /discovery/find`
- [x] 80 tests baseline

---

## Slice 2 — idempotency + central-core errors

- [x] All `src/` throws use `@livestreak/core` (no raw `Error`)
- [x] `idempotencyKeyFor` / `idempotencyKeyFromDraft` (vault-defining fields only)
- [x] `runtime/idempotency.ts` — at-most-once store with in-flight dedup + failure release
- [x] `originateVault` wires store; `idempotent` on created result
- [x] `chooseVaultAction` exact `vaultKey` candidate → join
- [x] Tests: store semantics, key determinism, core error types
- [x] `docs/flow.md` replay handled + receipt-timeout residual documented

---

## Slice 2b — wire idempotency into both entry points (Phase 6)

- [x] `runtime/create-vault-once.ts` — sole `chain.writer.createVault` caller via `createVaultOnce`
- [x] `originateVault` requires `guardedCreateVault` (no ephemeral `?? createIdempotencyStore()` default)
- [x] `bridge.callAction("createVault")` validates intent + routes through `runtime.createVaultOnce`
- [x] Bridge methods take injected `nowMs` for capability expiry (not `readSnapshot().updatedAtMs`)
- [x] Tests: originate + bridge share one store; expiry fail/pass; non-bigint rejection
- [x] `docs/flow.md` + this file updated

---

## Follow-ups

- [ ] **Residual:** receipt poll timeout after on-chain inclusion — re-check userOp receipt before retry send
- [ ] **UNHANDLED:** insufficient USDC balance preflight
- [ ] **UNHANDLED:** unknown market on-chain gate in `originateVault`
- [ ] Richer host discovery HTTP error mapping
- [ ] Wire long-running runtime loop to live observation feed at CLI edge
- [ ] `joinExistingVault` on-chain path (still intent-only)

---

## Hardening

- [x] `npm run check && npm run build && npm test`
- [x] No `new Error(` in `src/`; no `Effect.run*` in `src/`
- [x] Public-export guard updated
