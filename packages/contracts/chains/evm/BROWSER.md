# Browser-safe EVM exports

`@livestreak/contracts/evm` is browser-safe: no `node:fs`.

| Import | Use |
|--------|-----|
| `@livestreak/contracts/evm` | `addresses`, `contract()`, `localhostDeployment`, ABIs |
| `@livestreak/contracts/evm/abis` | ABI-only (no addresses) |
| `@livestreak/contracts/evm/node` | `loadAddressesFromDisk` (deploy scripts, Node only) |
| `@livestreak/contracts/evm/deployments/localhost` | Full `localhostDeployment` snapshot |

Promote after deploy regenerates `deployments/localhost.ts` from JSON.
