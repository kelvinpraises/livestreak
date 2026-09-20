# Browser-safety rules — chains/solana

Same contract as the EVM/Sui legs:

- `@livestreak/contracts/solana` (this dir's `index.ts`) is **browser-safe**: IDL const,
  seed constants, committed deployment snapshot, engine-wasm reader. No `node:fs`.
- `@livestreak/contracts/solana/node` holds disk loaders (`loadDeploymentFromDisk`) and
  must never enter a browser bundle. Deploy tooling (`deploy/`, `scripts/`) is node-only.
- `./deployments/localnet` is the committed snapshot const (regenerate via
  `npm run deploy:solana`).

## The wasm reader

`engine-wasm.ts` loads `wasm/livestreak_wasm_bg.wasm` — the on-chain engine compiled to
WASM (built by `wasm-pack build crates/livestreak-wasm --target web`, committed like the
generated ABIs). In Node it feeds the bytes via `fs`; in browsers it resolves the asset
with `new URL(..., import.meta.url)`, which vite handles natively. All lazy: nothing
touches wasm until `decodeProtocolState` is first called.

## Dependency posture

The browser barrel has **zero runtime deps** (no @solana/* imports — writes are built by
consumers via @livestreak/wallet, the single @solana/* owner). `@solana/web3.js` +
`@solana/spl-token` in package.json are used only by the node-only deploy tooling.
