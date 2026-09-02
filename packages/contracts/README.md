# @livestreak/contracts

Multichain protocol ABIs and deploy addresses. Chain-first layout: Foundry lives under `chains/evm/`; the npm facade is `kit/`.

## Layout

```text
chains/
  evm/          Solidity, tests, deploy, generated/abis.ts, deployments/, index.ts
  sui/          stub
  solana/       stub
kit/            export { evm, sui, solana }
```

## Consumer import

```ts
import { evm } from "@livestreak/contracts";
import { getContract, readContract } from "viem";

evm.vaultAbi; // flat ABIs (tree-shakeable)
evm.abis.vault; // typed map, narrow ABI preserved
evm.addresses.localhost.vault; // typed addresses (undefined if not deployed)

const vault = evm.contract("vault", "localhost");
getContract({ ...vault, client });
readContract({ ...evm.contract("treasury"), client, functionName: "skimBps" });
```

`evm.contract(name)` throws if the address is missing on that deployment. `evm.contract("vlt")` is a compile error.

Committed addresses live in `chains/evm/deployments/<network>.json`. Local `deploy/output/` is gitignored dev output.

## Commands

```shell
cd packages/contracts
npm run build    # forge + wagmi + tsc → dist/{kit,chains}
npm run test     # forge test in chains/evm
```
