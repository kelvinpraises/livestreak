# FlowStream contracts

Solidity/Foundry source of truth. CREATE2 deploy via `deploy/` (xylkstream pattern).

## Layout

```text
src/
  market/       MarketRegistry
  bookmaker/    BookmakerRegistry
  vault/        Side, Vault, VaultFactory, VaultFunding
  token/        FlowToken
  steward/      StewardRegistry
  aa/           AAImports.sol (enable after forge install of AA deps)
generated/      wagmi ABIs (npm run gen)
test/
```

Solidity source of truth: `src/`. Generated ABI/types: `generated/contracts.ts`. No handwritten TypeScript read/write layer in this package.

## Commands

```shell
cd packages/contracts
forge build && forge test
npm run gen
```

AA contracts (`src/aa/`) are not compiled until account-abstraction + safe-contracts deps are installed.
