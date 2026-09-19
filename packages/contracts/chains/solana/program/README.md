# LiveStreak on Solana

Ported from the Sui Move sources (`chains/sui/sources`) — Move already de-EVM'd the
design, so parity claims trace to Move first, EVM second. Layout:

- `crates/livestreak-math` — bonding-curve math (OZ ln kernel), pinned to the EVM
  golden vectors. Wide-by-default: U256/I256 everywhere, u128 only as storage.
- `crates/livestreak-engine` — the full protocol engine (streams/drips/vault/drivers/
  treasury), pure Rust, exact-conservation test suites. No Anchor dependency.
- `programs/livestreak` — the Anchor program wrapping the engine with SPL custody.

## Toolchain

Two sharp edges, both deliberate:

1. **Build tools come from the Anza release, not brew.** Homebrew's `solana` ships the
   validator/CLI but not `cargo-build-sbf`. The Anza install's PATH must precede brew:

   ```sh
   export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
   anchor build   # or: cargo-build-sbf
   ```

   `dev.sh`'s solana leg exports this itself; only manual builds need it.

2. **ruint is pinned to 1.17 and `Cargo.lock` is committed.** The SBF toolchain
   currently ships rustc 1.89; newer ruint releases require a newer compiler. A plain
   `cargo update` will break the on-chain build until Anza ships a newer toolchain —
   don't update deps without re-running `anchor build`. No `rust-toolchain.toml`:
   it would fight `cargo-build-sbf`'s own toolchain selection.

   ruint (not ethnum) is the U256: its serde is raw-limb binary. ethnum serializes
   U256 as decimal strings — one 256-bit division per digit — which silently cost
   ~1.2M CU per state write before the swap. I256 remains ethnum (signed, no serde
   in hot state).

## Tests

```sh
cargo test -p livestreak-math -p livestreak-engine   # host-side: math + conservation suites
anchor build && cargo test -p livestreak             # litesvm: on-chain keynote loop
```

The engine suites are the spec: every assertion is exact to the unit (no tolerances).
The program layer additionally enforces conservation live — every money-moving
instruction ends by requiring `escrow.amount == drips.held + vault.usdc_held +
treasury.usdc_held`, so a logic/codec/width bug aborts the transaction instead of
corrupting a market.
