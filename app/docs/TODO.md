# app — TODO

LiveStreak frontend (TanStack Start + React 19, Vite 7). Browser SPA/SSR.

---

## ✅ Wallet layering — DONE (slice 1, 2026-06-21)

The app no longer imports `@livestreak/wallet`. It derives `secret = sha256("livestreak-stealth-v1"+password)`,
fetches host `GET /aa/descriptor`, builds `EvmWalletInitConfig`/`WalletInit` (validated against `@livestreak/schema`),
and hands `{ seed, WalletInit, addresses }` to `@livestreak/options`, which owns the wallet + write transport.
`useStealthWallet.ts` + fictional `config/contracts.ts` ABIs deleted; `WalletContext` is a thin shim over
`OptionsContext` / mock-off. Slice 1 committed as `6acf67f`.

---

## Build / toolchain notes

- Pinned **Vite 7** + `@vitejs/plugin-react` 5 (node polyfills break under Vite 8's rolldown). Client-only
  polyfills, `protocolImports: false`. `app` is a **standalone npm install**, not in the root workspace.
- Build `packages/schema` + `packages/options` (`tsc`) before `app` check/build.
- Heavy transitive graph: `npm run lint` needs `NODE_OPTIONS=--max-old-space-size=4096`, `build` needs `=8192`
  (plain runs OOM, exit 134).
- Dev note: after a `package.json`/lockfile change, the first cold request can 500 during Vite optimizeDeps
  re-optimization (module graph invalidated mid-render); it self-heals on the next request.

---

## Cleanup done (2026-06)

- [x] Removed Circle wallets + passkey; dropped `/control` + `@livestreak/control-surface`; pnpm→npm.
- [x] 2026-06-20 hygiene: `$FLOW`→`$LVST`, fake-toast/two-option-modal removed, dead STREAM CTA wired.
- [x] 2026-06-20 bug-fix: `StreamSlider` neutral center thumb + init `x`; stake/unstake grey-out.

---

## Options integration (multichain, via `@livestreak/options` **bridge**)

Conform outward: consume `createOptionsBridge({ runtime })` only (`readBoard`/`readControls`/`subscribeBoard`/
`callAction`/`previewAccrual`) — never `model/`/`chains/` internals, never app-side viem reads. Gaps → options inbox.

### Slice 1 — descriptor connect + board reads + one `fund` write — DONE 2026-06-21 (verified, `6acf67f`)
- [x] `OptionsProvider` + connect (`resolveOptionsAccountAddress`) + `readBoard`/`subscribeBoard` via `adapters/optionsBoard.ts`.
- [x] STREAM CTA → `callAction('fund', …)`; USDC from `panel.user.usdcBalanceUSDC`; `useStealthWallet`/`contracts.ts` gone.
- Verified: check exit 0; atomic-string units correct; off-mode `/`+`/stream` HTTP 200.

### Slice 2 — controls registry (`functions[]`) + claims/stake UI — DONE 2026-06-21 (verified)
- [x] `OptionsContext`: `readControls`→`controls`; `findFunction`; `claimWin`/`claimLoss`/`stake`/`unstake`/`claimDividends`
      building grounded Inputs from `target` + address.
- [x] Green `withdraw` / red `claimLossLvst` on resolved vaults (`VaultCard`, `MyPositions`) via `OptionsActionButton`;
      `BalanceBar` stake/unstake/dividends from `functions[]`; enable/tooltip from `fn.disabled`/`disabledReason`.
- [x] Deposit-duration UX: removed `chainRate * 50n` magic; `fundDepositForDuration` (60-min default, 15–120 selector,
      "Funding $X over Y min").
- Verified by master prompter: check exit 0 (re-run); lint/build/test green; audits clean; args match
      `WithdrawInput`/`ClaimLossLvstInput`/`StakeLvstInput`/`UnstakeLvstInput`; `parseUnits(...,18)` for amounts;
      **no hot UI added** (dormant mock UI only). Off-mode all routes HTTP 200 (one-time cold-start 500 was a Vite
      optimizeDeps race, self-healed — not a code regression).

### Slice 3 — Funding UX: fund-gating (R10) + share-cost/accrual preview (R11) — DONE 2026-06-21 (verified)
- [x] **Fund gating (R10):** `useVaultFundingControls` reads `fund`/`stopFunding` from `functions[]`; FocusedVault `canStream`
      requires `!selectedFundFn.disabled` so a funded vault cannot fire a revert; slider locks + shows Stop (`stopFunding`).
- [x] **Share-cost (R11):** adapter maps `pools.sharePriceYes/No` (÷1e6); slider shows "Next share ~$X USDC";
      `useAccrualPreview` debounces `bridge.previewAccrual` (250ms). Share scale grounded `SHARE_SCALE=1e6`.
- Verified by master prompter: check exit 0 (re-run); lint/build/test green; audits clean (no curve math/wallet/deep-imports);
      off-mode `/`+`/stream` HTTP 200 (independently re-curled). Collapsed-card YES/NO buttons only `setExpanded` (harmless).

### Slice 4 — NFT transfer panel + exit-burn badge removal — ACTIVE (prompt written)
- [ ] NFT transfer panel: list `panel.nfts[]` (tokenId/marketId/laneCount/owner/approved/isOperator); transfer/approve/
      setApprovalForAll via `functions[]` (`target.kind==='nft'` + global), inputs `TransferNftInput {from,to,tokenId}`/
      `ApproveNftInput {operator,tokenId}`/`SetApprovalForAllInput {operator,approved}`; viem `isAddress` validation.
- [ ] Remove dead "EXIT BURN %" badge (permanent, no on-chain source): drop mock `exitBurn` + badge blocks in
      `VaultCard`/`FocusedVault`. Per `from-contracts__disable-exit-burn.md` + `from-options__new-capabilities.md`.

### Slice 5 — Sui — blocked (options `chains/sui` throws; host AA is EVM-only).

### Open findings / non-blocking
- **Runtime acceptance gate:** live path (`VITE_OPTIONS_MODE=on` + anvil 31337 + host:8787 → connect → board →
  fund/claim TxId) still **unproven** — only static + off-mode boot verified.
- **No hot/severity UI** from options (adapter maps `hot`→`open`); `exitBurnBps` is permanently `undefined`.
- Placeholders to revisit: `apy: 14.2`, position `minute` (wall-clock) — no options source.
