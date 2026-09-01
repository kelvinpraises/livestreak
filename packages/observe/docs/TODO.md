# @livestreak/observe — TODO

See [architecture.md](./architecture.md) for runtime model and phased delivery. See [repo TODO](../../../README.md) for global engineering rules.

**Mode:** keep stable; integration edges first, new big internals later.

---

## Stability

- [ ] Do not start new big internals before dependent package boundaries are written and contracts/bookmaker/steward surfaces are clearer.
  - Update (2026-06-17): dependent boundaries now EXIST in code — host `EndpointManifest`/`HostProviderDescriptor` (`packages/host/src/manifest.ts`, `descriptor.ts`) and contracts `MarketRegistry.registerMarket(title, streamId)` (`packages/contracts/src/market/MarketRegistry.sol`). Remaining blocker is contract *decisions* (field mapping/derivation), not missing surfaces — see Integration edges below.
- [ ] Final observe audit only after CLI / host / contracts integration points are clearer.

---

## Integration edges (priority)

None of these are wired in observe src yet (confirmed 2026-06-17: grep finds no `observeRunId`,
`subjectRef`, `manifestUri`, watch/webrtc, `evidenceRef`, `marketId` anywhere in `src/`). Each
exposes a NEW public read-model/contract, so per the hardening boundary it is flagged for a
design decision, not silently shipped. Blocking inbox requests filed:

- [ ] **Market registration edge plan** — blocked-on **contracts**: `context/temp-convo/contracts/inbox/from-observe__streamid-derivation.md`. Need the canonical `runId (string) -> streamId (bytes32)` derivation and whether `streamId` must be collision-checked on-chain before observe can expose a matching stream identity for the edge `registerMarket` write. (CLI/gateway/contracts perform the write; bookmaker does not create markets.)
- [ ] **Document read-model fields bookmaker + host need** — blocked-on **host**: `context/temp-convo/host/inbox/from-observe__endpoint-manifest-seam.md`. Field source/ownership map (each field is observe-owned, host-owned, or contracts-owned):

  | Field bookmaker/host expects | Source / owner | Status |
  | --- | --- | --- |
  | `observeRunId` | observe `runId` (`run/config/parse.ts`) — already on Board `system:run.readonly.runId` | exists internally; not yet a published market read-model field |
  | `streamId` (bytes32) | derived from `runId` — formula owned by **contracts** | blocked (contracts inbox) |
  | manifest URI / endpoint manifest | **host** assembles + signs `EndpointManifest`; observe provides raw endpoint facts | blocked (host inbox: seam) |
  | watch / WebRTC endpoint refs | observe originates raw URLs; host forwards/signs | blocked (host inbox: seam) |
  | `subjectRef` / subject metadata | **observe** — no `subject` concept exists today | not built (needs design) |
  | `observer` address | edge/gateway identity, not observe library | external (CLI/gateway) |
  | cache / evidence refs | observe attests id-only refs; host indexes | blocked (host inbox: seam) |

- [ ] **Host output transport plan** — blocked-on **host** CONFLICT: `context/temp-convo/host/inbox/from-observe__CONFLICT-output-mode.md`. observe/schema `OutputMode = file|local|simulcast` vs host `HostOutputMode = forwarder|local|file` (`simulcast` ≠ `forwarder`, not a shared enum). Must converge on one canonical remote-push literal before output uses the host descriptor instead of ad-hoc URLs.

---

## Proposed implementation — end-to-end market edge (AWAITING USER GO)

Full map: [flow.md](./flow.md). Per HARDENING-AGENT loop, proposed not shipped. AA stays at the
edge; observe stays a pure Effect lib (no chain/wallet/secret imports, no worker-blocking).

- [ ] **Slice 1 (recommended first): injected market-registration seam.** This is "how observe talks to the contracts edge." In-package, no other package's code needed.
  - `MarketRegistrationIntent` read-model (`runId`, `suggestedTitle?`, stream/endpoint/evidence refs — id-only, no blobs).
  - Injected `MarketRegistrationCoordinator` port via `ObserveRunKernelOptions` (mirrors `captureDriver` injection); observe CALLS it, the edge IMPLEMENTS the AA `registerMarket` UserOp.
  - New Board readonly channel `system:market` (`none→pending→registered(marketId)→failed(reason)`), **idempotent per runId**, non-blocking the worker; **verify** returned `marketId` vs streamId+observer (open-caller `registerMarket`).
  - Negative-path tests: no coordinator → stays `none`; coordinator failure/sponsorship-expiry → `failed`; double-start → no re-register; marketId mismatch → `failed`.
- [ ] **Slice 2: live output endpoint (host sink).** No live watch/webrtc endpoint exists today (file export only) → nothing to register. Blocked-on host output-mode CONFLICT + session seam.
- [ ] **Slice 3: host-session handoff fields.** Supply `contentId`/`observer`/`outputMode`; ingest signed `EndpointManifest` refs (id-only) into a `system:session` channel; handle manifest expiry/rotation. Blocked-on host seam inbox. Note: `ObserveRun.manifest` (`PublishManifest`) name-collides host `EndpointManifest` — pick distinct naming.
- [ ] **Slice 4: stream-end → market-close signal.** Surface a trustworthy stream-end fact keyed to `marketId` for a resolver (steward/contracts) to settle. Cross-package; observe provides only the signal. (Contracts has no `closeMarket`/`settleMarket` today — likely a contracts ask.)

---

## Future pipeline slices (after integration)

- [ ] IPTV capture under `pipeline/capture/iptv/`
- [ ] Football process pack under `pipeline/process/football/`
- [ ] Simulcast / host sink under `pipeline/publish/sinks/simulcast/`

---

## Engineering (when touching observe)

- [x] Keep `#index.js` public-edge contract tests green — green 2026-06-17 (58 files / 410 tests pass)
- [x] Keep architecture guards: Effect purity, forbidden imports, no empty files — all guard suites green; no new public API added this run
- [ ] Match `AGENTS.md` file shape and dependency order

---

## Hardening (every slice) — run 2026-06-17

Run after touching this package. Full checklist: [repo TODO § Hardening loop](../../../README.md#hardening-loop).

- [x] check / build / test / lint for `packages/observe` — `check` clean, `build` clean, **410 tests / 58 files pass**, `lint` exit 0
- [x] Stale-term + forbidden-import + empty-file + no `Effect.run*` in `src/`:
  - Fixed: 2 stale `packages-re2/bookmaker/...` paths in `docs/architecture.md` → `packages/bookmaker/...`
  - Removed: stray empty `.python-version` + `requirements.txt` at package root (junk in a TS package; football CV is unimplemented and lives under `pipeline/process/football/cv/`)
  - Clean: no `Effect.run*` in `src/`; pipeline imports only `#run/control/bus/{calls,types}.js`; panel pure (no Effect/node/worker imports); no secrets in src
- [ ] Negative-path test for every new public API — n/a this run (no new public API; integration edges blocked, see above)
- [x] Update this `docs/TODO.md` — done 2026-06-17
