# CLI / Gateway — TODO

`cli/` is a **top-level domain**, not a package. It **sequesters** the executor/library packages
(`observe`, `options`, `steward`, `bookmaker`) behind one operator surface, and talks to `host` over its
stable HTTP contract. It is the application **edge** — the only place `Effect.run*` is allowed.

## The model (gateway = authn, bridge = authz)

- **gateway = authentication.** The CLI owns *who gets in* and *who the caller is*. It is the **root sudo
  operator**: identity derives from a password → seed (`sha256("livestreak-stealth-v1" + password)`,
  testnet-only, mirrors the app), and that account is the on-chain `creator`/`holder`.
- **bridge = authorization.** Each package owns its own scope checks (`bridge/scope.ts`,
  `authorizeBridgeCaller`). The CLI **consumes** those bridges via `adapters/`; it never reimplements authz.
- **Packages own chain writes — the CLI is a pure router.** Three writes (`goLive`/`setEnded`,
  `createVault`, `mint`) sit in `adapters/onchain.ts` as TEMP stopgaps only because no package exposes them
  yet (gaps filed to observe/options/bookmaker). They reuse the same wallet (seed+config) the CLI hands a
  package, so creator identity holds. When the packages absorb them, `onchain.ts` is deleted.

## Structure — flat router (✅ restructured 2026-06-20)

```
cli/src/
  main.ts        # the ROUTER: build the @effect/cli app, register commands, Effect.runMain
  commands/      # the routes (CLI edge): produce · vaults · vault · nft · lanes · host · args
  adapters/      # clients to sibling packages: observe · options · host  (+ onchain.ts = TEMP direct writes)
  gateway/       # AUTHN: identity (pw→seed) · caller · operator (seed+wallet+doc session)
  prefs/         # floating-gate persistence: init-doc (config + run cache); never the seed
  render/        # output formatting
```

**No `chains/` layer** — packages own chain interaction; the CLI routes to them. The only direct-chain code
is `adapters/onchain.ts`, a clearly-marked TEMP unit that deletes when observe/options/bookmaker expose
`setEnded`/`mint`/`createVault`. Verified: check/build/test green (38/1), Effect at edge only, browser-safe
abis, 21→16 files.

---

## Slice plan

### R1 — Producer spine — ✅ SHIPPED & VERIFIED (2026-06-20)

`livestreak produce --title --video` end to end: a stream (file capture) becomes a **real on-chain market
with `streamState = Ended` pointing at a Walrus VOD**. Master-prompter verified (ran check/build/test +
read source): creator-wallet reuse correct (same seed → observe `registerMarket` AND `goLive`/`setEnded`);
contract writes correct (browser-safe `marketRegistryAbi`, scheme→StorageScheme, id 1..64, goLive→setEnded,
`streamState` Ended+id assert); Effect at edge only; no baked seed (init-doc `FORBIDDEN_SERIALIZED_KEYS`
guard rejects seed/password on save+load); types imported from owners.

- [x] `gateway/{identity,caller}.ts`, `chains/evm.ts`, `edges/{host,observe,market}.ts`,
      `prefs/init-doc.ts`, `commands/produce.ts`, `render/output.ts`, `main.ts`
- [x] check / build / test green — 8 passed, 1 skipped (= the live `produce` test)
- [x] **Residual cleanup:** DONE — R2 step 0 deleted the 6 dead stubs (`bridge/*`, `host.ts`,
      `observe.ts`, `run.ts`); verified `stubs cleaned ✓`
- [ ] **Live proof pending:** the `produce` round-trip is NOT RUN (needs anvil + AA bundler/paymaster +
      host on Walrus + `LIVESTREAK_CONFIG`/`LIVESTREAK_VIDEO`/`LIVESTREAK_PASSWORD`). Correct by
      inspection; unproven live. Also confirm `walletInit.seedSource` doesn't diverge observe's wallet
      derivation from the CLI's (would surface as `"not creator"`).

### R2 — Options vault UX — ✅ SHIPPED & VERIFIED (2026-06-20)

`livestreak vaults / vault create / fund / claim [--loss] / stake / unstake / dividends` via the options
**bridge** (plain Promises; Effect only in `commands/` + `main`). Verified (ran check/build/test + read
source): 15 passed / 1 skipped; edge wires `createOptionsChain→Runtime→Bridge` with a trusted operator
caller; win→`withdraw` / loss→`claimLossLvst` routing correct; USDC `approve` is exact-amount +
allowance-checked (spender = marketDriver for fund, vaultDriver for vault-seed), no shim; operator
`vault create` via `VaultDriver` + `VaultCreated` parse; types from owners; same R1 wallet.

- [x] options edge + vault-seed + 7 commands + render + init-doc extension; check/build/test green
- [x] R1 stub cleanup done (step 0)
- [ ] **Live proof pending** (shared with R1): produce → vault create → fund → claim → stake needs anvil +
      AA bundler/paymaster + host-on-Walrus + **operator USDC**. Correct by inspection; unproven live.

### R3 — Complete the operator surface — ✅ SHIPPED & VERIFIED (2026-06-20)

`set-lanes` (hedge / multi-lane), `stop-funding`/`stop-all`, `withdraw-many`, `nft
transfer`/`approve`/`approve-all` — all via R2's bridge `callAction` (no new edge). Verified (ran
check/build/test + read source): 27 passed / 1 skipped; `parseLaneSpec` validates `vaultId:side:rate`
(bytes32 + side brand + rate>0); USDC approve only when `set-lanes --add-deposit > 0` (spender =
marketDriver); correct envelopes; types from owners.

- [x] 7 commands + shared `cli-args.ts` parsing; check/build/test green
- [x] **tokenId mint finding (the missing link):** `fund`/`setLanes`/`claim` need an already-held
      `tokenId`; there is NO CLI mint. `MarketDriver.mint(marketId,to)` / `mintWithSalt(marketId,salt,to)`
      exist (deterministic via `calcTokenIdWithSalt`, emits `MarketNftMinted`); options' writer doesn't
      expose mint → **R4 closes it** (direct marketDriver write, like the vault-seed).

### R4 — `nft mint` (close the operator loop) — ✅ SHIPPED & VERIFIED (2026-06-20)

`livestreak nft mint --market [--salt] [--to]` — direct `MarketDriver.mint`/`mintWithSalt` write (free, no
USDC); tokenId from `MarketNftMinted` (the salt path also asserts it `== calcTokenIdWithSalt`); persisted to
`run.tokenId`; `--token` now optional across fund/set-lanes/claim/stop-*/withdraw-many (defaults to the cached
tokenId, loud error if neither). Verified (ran check/build/test + read source): 38 passed / 1 skipped; edge
is plain Promises, `marketDriverAbi` browser-safe, types from owners.

**Operator surface is now CODE-COMPLETE.** The self-contained loop runs end to end (by inspection):
produce → vault create → nft mint → fund → set-lanes/hedge → claim/withdraw → stake → nft transfer.

### R5 — Full command CLI: `init` + secure `login` + live e2e — ✅ SHIPPED & VERIFIED (2026-06-21)

Full command CLI, NO TUI. `init` bootstraps `livestreak.json` from the deploy artifact
(`deployments/localhost.json`) + host descriptors; secure `login` + **interactive hidden password** (seed
never in argv/history/disk; password resolves flag → env → prompt across every write command); gated live
e2e + `cli/docs/dev-stack.md`. Built by Sonnet (two runs — first hit a session limit mid-edit, leaving the
package broken; second completed), then master-prompter verified + repaired.

- [x] `commands/{init,login}.ts`, `gateway/password.ts`, `run.operator`, registered in `main.ts`; 52 passed
      / 3 skipped; `init`+`login` reachable; seed/password never persisted.
- [x] **Review repair (real connection bug):** the agent built `bundlerUrl`/`paymasterUrl` from the
      `chainId` (`/aa/bundler/31337`), but the host keys those routes by **routeKey** (a chain NAME, e.g.
      `local`). Fixed `init` to read `bundlerPath`/`paymasterPath` from host `/aa/descriptor` (matched by
      chainId) via a new `adapters/host.ts` `getAaDescriptor()` — would otherwise have failed every AA
      userOp at the live run (mocks hid it).
- [ ] **Live RUN still pending** — needs the stack (anvil + AA + host-on-Walrus + funded operator USDC);
      gated test exists, goes green on Kudaben's machine. Done together.

### R6+ — later / blocked
- [ ] **Steward Memory (M3)** — the "it remembers" idea (steward `MemoryFactSource` + `StewardMemorySink`
      over MemWal + host `/memory/access`). **Deprioritized, NOT wallet-blocked:** the prior M3 prompt was
      set aside on priority. `@livestreak/wallet` Sui support is **done** (verified — real
      `chains/sui/*`: Ed25519 keypair, signing, sponsored-tx), so the dual-wallet piece is available now.
      Only open external item = confirm the host `/memory/access` Sui owner is wired (its old "stub until
      wallet Sui lands" condition is now met). Re-scope from scratch if revived.
- [ ] **Bookmaker loop** — agent edge. Bookmaker is mid-transition to executor and hasn't briefed the CLI;
      request its integration contract by inbox before wiring.

### Deferred — remote admission (seam in R1, build later)

Multi-device "admit others": the gateway mints `CapabilityGrant`s for joined devices; bridges enforce them.
R1 ships only the **local sudo** path (`trusted: true`). Two cross-package prerequisites are filed:

- [ ] canonical `BridgeCaller` + `CapabilityGrant` in `@livestreak/schema` — filed
      `context/temp-convo/schema/inbox/from-cli__canonical-bridgecaller-grant.md` (today duplicated in
      observe/options/bookmaker; nominal brands aren't assignable across the mint boundary)
- [ ] host join/redeem/session endpoint + signed-grant verification — filed
      `context/temp-convo/host/inbox/from-cli__remote-admission-endpoint.md` (no such endpoint exists;
      `/control` route was dropped)

---

## Inbox (integration contracts the CLI builds against)

- `from-host__host-contract.md` — stable HTTP: `/descriptor`, `/aa/bundler/:chain`, `/aa/paymaster/:chain`,
  `/content/blobs`, `/memory/access`. Single-player; Sui owner stubbed.
- `from-observe__producer-edge-orchestration.md` — the R1 flow (config → run → upload → `setEnded`); same
  creator wallet; two-step `goLive`+`setEnded` in file mode.
- `from-options__cli-integration.md` — options bridge surface + wallet-direct config + floating gate (R2).
- `from-steward__memory-m3-edge.md` — M3 ports (predates host M1.6; network field is `walrus.network`).

---

## Laws (every slice)

- **Public APIs only.** Consume each package's bridge / public exports; never reach into internals.
- **Effect only at the edge** (`main.ts` + the observe edge wrapper). options/steward are plain Promises.
- **Import every type from its owner** — no duplicate protocol types (host ← `@livestreak/host`,
  `WalletInit` ← `@livestreak/schema`, ABIs ← `@livestreak/contracts/evm/abis`).
- **Seed at runtime, never baked.**
- **Design-out:** a source-fixable blocker in another package → STOP and file
  `context/temp-convo/<pkg>/inbox/from-cli__<topic>.md`; never shim on the CLI side.

## Hardening loop (run after each slice)

- [ ] `cd cli && npm run check && npm run build && npm test`
- [ ] Stale-term + forbidden-import (no `Effect.run*` outside `main`/edges) + empty-file scans
- [ ] No baked seed/keys/URLs
- [ ] Negative-path test for every new command
- [ ] Update this `docs/TODO.md`
