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

## Slice 3 — encode unit tests + on-chain createVault proof

- [x] `test/chains/evm/encode.test.ts` — coercion layer (side, marketId, deposit, seedRate)
- [x] `test/e2e/create-vault.e2e.ts` + `npm run e2e:chain` (opt-in; not in `npm test`)
- [x] `e2e:chain` run against live anvil + deploy + host (see `docs/flow.md`)

---

## Slice 4 — adopt contracts VaultCreated fix (drop emitter filter)

- [x] Inner `Vault.VaultCreated` renamed → `VaultOpened` in `@livestreak/contracts` (`7461f19`)
- [x] `parseVaultCreatedFromLogs(logs)` — no `vaultDriverAddress` filter; topic0 unique to driver
- [x] Regression test: driver `VaultCreated` + inner `VaultOpened` → correct `vaultId`
- [x] E2e re-run without emitter filter

---

## Slice 5 — createVault retry-safety + cross-runtime doc

- [x] `confirmCreateVault(userOpHash)` on `BookmakerChainWriter` (EVM + fake + Sui stub)
- [x] Receipt-timeout carries `userOpHash`; idempotency store tracks pending hashes
- [x] `createVaultOnce` never blind-resubmits a pending key — confirm first
- [x] Tests: timeout+recover, pending-then-pending, pre-hash retry, concurrency
- [x] `docs/flow.md` cross-runtime limitation documented

---

## Slice 6 — region barrel alignment

- [x] Region `index.ts` files reordered to match options convention (exports only, no logic)

---

## Slice 7 — observe-style 6-region layout

- [x] Top-level `src/` is exactly: `model`, `pipeline`, `chains`, `flows`, `runtime`, `bridge`, `index.ts`
- [x] Pipeline stages grouped under `pipeline/` (`observation`, `detection`, `draft`, `similarity`, `decision`)
- [x] Model validators collapsed to `model/validate.ts`; runtime config validator in `runtime/validate.ts`
- [x] `BookmakerPanelView` + watch refs live in `model/watch-source.ts`; projection stays in `bridge/panel/`
- [x] `create-vault-recovery.ts` under `chains/evm/`
- [x] Tests relocated: `test/model/validate-*.ts`, `test/runtime/validate-runtime-config.test.ts`
- [x] `docs/architecture.md` + `docs/flow.md` updated
- [x] 117 tests green; public API membership unchanged

---

## Follow-ups

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
