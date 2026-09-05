# Browser-safe Sui exports

`@livestreak/contracts/sui` is browser-safe: no `node:fs`.

| Import | Use |
|--------|-----|
| `@livestreak/contracts/sui` | `localnetDeployment`, `MODULES`, `target`, `LiveStreakSuiClient`, types |
| `@livestreak/contracts/sui/node` | `loadDeployment`, `listDeployments` (deploy scripts, Node only) |
| `@livestreak/contracts/sui/deployments/localnet` | Same `localnetDeployment` const (optional subpath) |

Deploy scripts may also import `loadDeployment` from `../addresses.js` inside this package.
