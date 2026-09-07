# app E2E test harness (agent-2)

Additive test affordances for the CDP/Arc E2E agent. No default/fixture behavior changes.

## Deterministic test wallet (seed 1234)

Set the test seed via env, used together with REAL options mode against the local deployment:

```
VITE_OPTIONS_MODE=on
VITE_OPTIONS_SEED=1234
```

When `VITE_OPTIONS_SEED` is set:
- `OptionsProvider.connect()` derives the operator secret from the configured seed instead of
  the typed password. Derivation is byte-identical to the CLI (`deriveSeedFromPassword`):
  `secret = sha256("livestreak-stealth-v1" + seed)`.
- `ConnectButton` pre-fills the password field from the seed so the modal's Continue enables
  without typing.
- When the env var is unset, both paths are undefined → unchanged manual-password / fixture flow.

### Reproducible derived identity (seed = "1234")

- seed hex (chain-agnostic): `0xfe91998fa654dd8f6a82e2a0530daa9517b12713f17df70127160941621d6a9a`
- Sui operator address: `0xd38c2a60ad329d08c42e5526dff0a9ff63d22fb72b7acc0e7c04724ed4a0caa9`
- EVM Safe address: derived deterministically from the same seed via `@livestreak/wallet` +
  the local AA descriptor/deployment at connect time (counterfactual Safe; nothing hardcoded).

Verified reproducible: the sha256 seed and the Sui address are byte-stable across repeated runs
(derived from the seed only).

## CDP `data-testid` selectors

Connect / wallet (`connect-button.tsx`):
- `connect-wallet` — open Connect modal
- `connect-password` — password input
- `connect-submit` — Continue (derive + connect)
- `wallet-menu` — connected address/balance menu trigger

Chain selector (`chain-selector.tsx`):
- `chain-selector` — container
- `chain-select-evm`, `chain-select-sui` — per-chain buttons

Vault card (`vault-card.tsx`), `<vaultId>` is the on-chain vault id:
- `vault-card-<vaultId>` — card container
- `fund-yes-<vaultId>`, `fund-no-<vaultId>` — fund-side controls
- `fund-amount-<vaultId>` — stream rate / amount control (wraps StreamSlider)

Remote console `/remote/$session` (`remote-console.tsx`):
- `remote-gate-form` — password gate form
- `remote-password` — session password input
- `remote-unlock` — unlock/submit
- `remote-fn-<fnName>` — each in-scope function card

Auto-form (`auto-form.tsx`):
- `auto-form` — form
- `auto-form-field-<propName>` — each generated field input/select/textarea
- `auto-form-submit` — submit
