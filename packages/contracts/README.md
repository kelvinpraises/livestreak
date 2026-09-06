# @livestreak/contracts

Multichain protocol ABIs and deploy addresses. Chain-first layout: Foundry under `chains/evm/`, Move under `chains/sui/`, npm facade in `kit/`.

## Deployments

### Sui testnet — live

Deployed **2026-06-21** to Sui testnet. Full snapshot: [`chains/sui/deployments/testnet.json`](chains/sui/deployments/testnet.json).

| Field | Value |
| --- | --- |
| RPC | `https://fullnode.testnet.sui.io:443` |
| Deployer | `0x668cfc490bd30cf8d4666e3ff39cc7fded31deee89d105267011d01abea94e84` |
| Package ID | `0x405f99daf3690baf6211783e1492c86c4c600ed1d0a0e6aadcd7b992d149200e` |
| Protocol | `0xe983e2108a3ab870399b1c08453eaaf750c495ef63854b216ae5288bb194be00` |
| Market registry | `0x45d4acbfb9d0383f0e682c2636f7edf07367d7046585b1b53dc279a30131b66d` |
| Vault registry | `0xab2432ade27f45a7970cc4168f15469fd27cbde6a142bdb3e3e755fd530e1a96` |
| Steward registry | `0x415e43223f347f73bf6956d2427b619c1ac7758568c89380ce0a4f0841ecd598` |
| Treasury registry | `0x3f510590fd5135324993dde628bf1f27a228fc2567d8e0acb7c5d782b4f7b83f` |
| Drips registry | `0xab4a571838f64478adb6d239b1cdc53891eea118e8312e8c1c7615d7e50aac6c` |
| Streams registry | `0x208fe9b51eee0d050eed13a31c87059c046028b501c62e5f0901e9a4140e73c7` |
| Vault driver registry | `0xa41e6ff9c70b77965b7ac9d66bfeef063b1c3623c4a741244e1773a442c212b3` |
| Market driver registry | `0xb3293e6b7ef15be9b7043e987ca255da257e573cfdf9e780f373df427079ac6c` |
| Driver registry | `0x83a627d1b93791133638ff7ec25e1246b994089fec452b2badd698603a55bf4b` |
| LVST treasury cap | `0x3065ea9f9e57d54aad93616dd1d14a7c276c1726cb101f9ddbf5bb6a59557a3d` |
| Mock USDC mint cap | `0x7c7e8723edac3a6e71a6caba5d09bc0c433452b8b63552147dbb8a9b041831b4` |

Explorer: [package on Suiscan](https://suiscan.xyz/testnet/object/0x405f99daf3690baf6211783e1492c86c4c600ed1d0a0e6aadcd7b992d149200e)

```ts
// browser-safe typed const
import { testnetDeployment } from "@livestreak/contracts/sui/deployments/testnet";

// Node: load JSON snapshot
import { loadDeployment } from "@livestreak/contracts/sui";
const d = loadDeployment("testnet");
```

#### Deploy / redeploy to Sui testnet

Prereqs: Sui CLI ≥1.73, `sui client switch --env testnet`, funded active key (~5 SUI; publish needs a single coin ≥3 SUI — merge coins if needed).

```shell
cd packages/contracts
npm run deploy:sui -- --name testnet          # first deploy
npm run deploy:sui -- --name testnet --force  # redeploy
```

Optional: `SUI_SECRET_KEY` or `SUI_MNEMONIC` instead of the CLI keystore. Outputs `chains/sui/deployments/testnet.json` + `testnet.ts`.

Localnet (ephemeral `sui start --with-faucet`):

```shell
npm run deploy:sui -- --name localnet
npm run e2e:sui
```

### Sui localnet — dev

Snapshot: [`chains/sui/deployments/localnet.json`](chains/sui/deployments/localnet.json). Requires `sui start --with-faucet`.

### EVM localhost — dev

Snapshot: [`chains/evm/deployments/localhost.json`](chains/evm/deployments/localhost.json). Anvil + AA stack; no public EVM testnet deployment yet.

```shell
cd packages/contracts/chains/evm && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

## Layout

```text
chains/
  evm/          Solidity, tests, deploy, generated/abis.ts, deployments/, index.ts
  sui/          Move sources, deploy/, deployments/, LiveStreakSuiClient kit
  solana/       stub
kit/            export { evm, sui, solana }
```

## Consumer import

### EVM

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

### Sui

```ts
import { LiveStreakSuiClient } from "@livestreak/contracts/sui";
import { testnetDeployment } from "@livestreak/contracts/sui/deployments/testnet";

const client = new LiveStreakSuiClient({ deployment: testnetDeployment });
```

Committed addresses live in `chains/*/deployments/<network>.json`. Local `deploy/output/` is gitignored dev output.

## Commands

```shell
cd packages/contracts
npm run build    # forge + wagmi + tsc → dist/{kit,chains}
npm run test     # forge test in chains/evm
npm run deploy:sui -- --name testnet|localnet
```

Sui Move tests:

```shell
cd chains/sui && sui move build -e testnet && sui move test --build-env testnet
```
