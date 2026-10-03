# Bookmaker flow — detect → draft → discovery → decide → execute

End-to-end vault origination inside `@livestreak/bookmaker`. Bookmaker holds the multichain wallet via `chains/` and publishes verified mandate bytes before executing bound vault creation in-package.

## Ideal path

```text
observation events
  → detectOpportunity (pipeline/detection/)
  → buildVaultDraft (pipeline/draft/) — derives seedRate = creatorStake / windowSeconds
  → findSimilar via POST /discovery/find (pipeline/similarity/)
  → chooseVaultAction (pipeline/decision/) — exact vaultKey join + fuzzy policy
  → originateVault (flows/) — guardedCreateVault → runtime.createVaultOnce → chains.writer.createVault(intent)
  → VaultCreated event → vaultId
  → runtime.publishSnapshot + bridge panel projection
```

## Caller injects (never baked)

| Input | Used by |
| --- | --- |
| `walletInit` + `seed` | `createBookmakerChain` → `createWalletManager` |
| `addresses` (`vaultDriver`, `marketRegistry`, `vault`, `usdc`) | EVM reader/writer |
| `readRpcUrl` (optional) | EVM `marketExists` reads |
| `similarityClient` or `createHostDiscoveryClient(baseUrl)` | `findSimilar` |
| `guardedCreateVault` (required; typically `runtime.createVaultOnce`) | `originateVault` at-most-once guard via shared runtime store |
| `fundingToken`, `policy`, `marketContext`, `watchSource` | runtime + draft |
| `nowMs` | all pure stages + bridge authz (no `Date.now()` in `src/`) |
| `nowMs` on bridge methods | capability expiry + `callAction` validation clock |

## Stage edge map

| Stage | Edge | Handled? |
| --- | --- | --- |
| Detection | No detectors / below confidence | Yes — `action: "skip"` |
| Detection | Malformed detector output | Yes — ignored / normalized |
| Draft | `windowSeconds <= 0` | Yes — no `seedRate`; `validateVaultDraftForCreate` fails |
| Draft | Missing stake | Yes — validation fails before execute |
| Similarity | Host 4xx/5xx | Partial — `createHostDiscoveryClient` throws `LiveStreakRuntimeError` |
| Similarity | Empty candidates | Yes — decision policy chooses create/join/skip |
| Similarity | Exact `vaultKey` match on candidate | Yes — `chooseVaultAction` joins |
| Similarity | `duplicateRisk: high` + `skip-on-high` | Yes — skip |
| Decision | Cross-market similarity result | Yes — skip `market_mismatch` |
| Decision | Steward warnings | Yes — skip |
| Execute | Retry / replay / concurrent duplicate create | Yes — `runtime.createVaultOnce` + shared `idempotencyStore` (originate + bridge) |
| Execute | UserOp included but receipt poll times out | Yes — pending `userOpHash` recorded; retry calls `confirmCreateVault` (never blind-resubmit) |
| Execute | Unknown `marketId` on-chain | **UNHANDLED** — reverts at `VaultDriver.createVault` |
| Execute | Insufficient USDC balance | **UNHANDLED** — ERC20 transfer reverts |
| Execute | Insufficient allowance | Partial — writer auto-approves up to deposit |
| Execute | UserOp send / paymaster failure | Partial — classified `LiveStreakRuntimeError`; key released when no hash |
| Execute | Receipt missing `VaultCreated` | Yes — `LiveStreakRuntimeError` |
| Execute | Solana / Sui | Bound creation with explicit mandate, chain identity and operation; updated chain deployment required |
| Bridge | Missing scope | Yes — `LiveStreakCapabilityError` |
| Bridge | Expired capability grant | Yes — injected `nowMs` vs `grant.expiresAt` |
| Bridge | `createVault` double-submit | Yes — same `createVaultOnce` + store as originate |
| Bridge | Trusted caller | Yes — short-circuit v0 |
| Runtime | Not deployed / wrong addresses | **UNHANDLED** — fails at RPC or revert |

## Idempotency layers

1. **Within-runtime (deterministic):** `idempotencyKeyFromDraft` / `idempotencyKeyFromCreateIntent` hash vault-defining fields. `BookmakerRuntime.createVaultOnce` validates intent, computes key, and enforces at-most-one submit per key: settled → cached; pending `userOpHash` → `confirmCreateVault` (never blind-resubmit); new → `createVault`. Receipt-timeout records the hash as pending. Originate passes `guardedCreateVault: runtime.createVaultOnce`; bridge `callAction("createVault")` calls the same method.
2. **Across runtime restarts:** all three writers look up the caller-supplied operation in authoritative chain state before publication/submission. Identical terms return the original vault, including after the funding deadline; conflicting terms reject. The contract also enforces that identity atomically. Different operations can intentionally create different vaults; similarity discovery does not make distinct operations unique.

## Multichain layout

```text
chains/     inward door — wallet + vaultDriver writes
flows/      orchestration — originateVault
runtime/    floating-gate state + idempotency store + subscriptions
bridge/     outward door — panel + scoped callAction
```

## Contract truth

Creation requires caller-authored `livestreak-mandate/1` terms, a nonzero 32-byte operation ID, and `hostUrl`. The writer verifies the actual RPC chain identity, publishes the canonical bytes and checks their digest before signing. Creation stores the immutable commitment and funding deadline with the seed. Failed publication/readback sends no creation transaction.

- EVM: `VaultDriver.createBoundVault`; `VaultCreated` identifies the vault.
- Sui: `vault_driver::create_bound_vault`; immutable dynamic fields hold terms and creator/operation recovery. Split-coin values use `u64`.
- Solana: `create_vault_seeded` now requires commitment, funding close and operation ID; the new v2 protocol state and WASM reader must ship together. Retry skips the SPL deposit transfer.

Independent Options/Steward readers bind the exact body to chain, market, question, commitment and deadline. New funding/top-ups require a verified, open mandate; removal/refund paths remain available without Host content. SDK checks use chain time, and actual streaming/accounting stops at each vault's deadline.

Solana requires a fresh alpha protocol state: old unversioned engine blobs are rejected explicitly. Existing deployment snapshots are not a migration plan. No public deployment is claimed by these local tests.

## Errors

Configuration, capability, transaction and mandate-validation failures propagate to the caller. Missing terms are never replaced by inferred settlement defaults.

## On-chain proof (opt-in)

Fast unit tests use a fake chain. The real executor path — `createWalletManager → USDC allowance → encode → AA send → poll → parse VaultCreated` — is covered by:

- `test/chains/evm/encode.test.ts` — pure coercion (`sideToSolidityValue`, deposit/rate bounds, bytes32 marketId)
- `test/e2e/create-vault.e2e.ts` — live stack proof via `npm run e2e:chain`

```text
anvil --port 8545 --block-time 1
cd packages/contracts && npm run deploy -- --name localhost --force
cd host && LIVESTREAK_AA_RPC_URL=http://127.0.0.1:8545 \
  LIVESTREAK_AA_ENTRY_POINT=0x0000000071727De22E5E9d8BAf0edAc6f37da032 \
  LIVESTREAK_AA_PAYMASTER_ADDRESS=<from localhost.json scopes.paymaster> \
  LIVESTREAK_AA_ALLOW_DEV_KEY=1 npm run dev
cd packages/bookmaker && npm run e2e:chain
```

Host `deploy-env` reads flat snapshot fields; `localhost.json` nests under `scopes` — set AA env explicitly (or use `LIVESTREAK_AA_CHAINS_FILE`) so embedded Alto starts.

The e2e script mints USDC to the bookmaker Safe, registers a market, runs `chain.writer.createVault`, and asserts the returned `vaultId` matches the `VaultCreated` event and `Vault.vaultExists`.
