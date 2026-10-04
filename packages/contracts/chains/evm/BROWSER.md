# Browser-safe EVM exports

`@livestreak/contracts/evm` is browser-safe: no `node:fs`.

| Import | Use |
|--------|-----|
| `@livestreak/contracts/evm` | `addresses`, `contract()`, `arbitrumSepoliaDeployment`, `localhostDeployment`, ABIs |
| `@livestreak/contracts/evm/abis` | ABI-only (no addresses) |
| `@livestreak/contracts/evm/node` | `loadAddressesFromDisk` (deploy scripts, Node only) |
| `@livestreak/contracts/evm/deployments/localhost` | Full `localhostDeployment` snapshot |

`contract()` and the Node loader default to `arbitrum-sepolia`. Local tests must explicitly select `localhost`.

`@livestreak/contracts/evm/deployments/arbitrum-sepolia` exports the generated full snapshot. The frontend imports `arbitrumSepoliaDeployment` from the EVM entry point; it does not copy addresses into environment JSON.

Promote after deploy regenerates the selected deployment TypeScript snapshot from JSON.
