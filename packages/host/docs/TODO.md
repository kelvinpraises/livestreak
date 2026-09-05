# @livestreak/host — TODO

## AA / wallet sponsorship

- [x] EVM AA descriptor (`AaCapabilityDescriptor`, bundler/paymaster paths).
- [x] Sui sponsorship descriptor (`SuiSponsorshipDescriptor` on AA capability).
- [x] Host edge Sui gas station route (`POST /aa/sui/sponsor`) — implemented in `host/` server package.

## Blocked / downstream

- [ ] App-edge `SuiGasStation` HTTP adapter (inject port into wallet config) — observe/app slice.
- [ ] Schema `SuiGasStationInitConfig` — blocked on `schema/inbox/from-wallet__sui-gasstation-config.md`.
- [ ] CI peer-verify against Sui localnet — manual script at `host/scripts/sui-sponsor-peer-verify.mjs`.
