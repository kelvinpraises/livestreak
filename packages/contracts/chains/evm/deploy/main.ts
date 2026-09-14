import { parseArgs } from "node:util";
import { type Hex, parseEther } from "viem";
import { defaultChains } from "./chains.js";
import {
  createClients,
  ensureNickFactory,
  promoteDeployment,
  readState,
  writeState,
  type DeployState,
  type ScopeFn
} from "./utils.js";
import { deployAA } from "./scopes/01-aa.js";
import { deployStreaming } from "./scopes/02-streaming.js";
import { deployProtocol } from "./scopes/03-protocol.js";
import { deployWire } from "./scopes/04-wire.js";
import { deployPaymaster } from "./scopes/05-paymaster.js";

const SCOPES: { key: string; fn: ScopeFn }[] = [
  { key: "aa", fn: deployAA },
  { key: "streaming", fn: deployStreaming },
  { key: "protocol", fn: deployProtocol },
  { key: "wire", fn: deployWire },
  { key: "paymaster", fn: deployPaymaster }
];

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    rpc: { type: "string" },
    scope: { type: "string" },
    force: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    help: { type: "boolean", default: false }
  }
});

if (values.help) {
  console.log(`
Usage: npm run deploy -- [options]

Options:
  --name <chain>     Chain name (e.g. localhost, flow-testnet)
  --rpc <url>        Custom RPC URL
  --scope <name>     Deploy only this scope (aa, streaming, protocol, wire, paymaster)
  --force            Force redeploy even if scope is completed
  --all              Deploy to all default chains
  --help             Show this help
`);
  process.exit(0);
}

const deployerKey = (process.env.DEPLOYER_PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;

/** Returns false when any scope failed or the snapshot promotion failed — the process must exit 1. */
async function deployToChain(chainName: string, rpc: string): Promise<boolean> {
  console.log(`\n========== Deploying to ${chainName} ==========`);
  console.log(`RPC: ${rpc}\n`);

  const { publicClient, walletClient, account } = createClients(rpc, deployerKey);
  const chainId = await publicClient.getChainId();
  const deployer = account.address;

  console.log(`Chain ID: ${chainId}`);
  console.log(`Deployer: ${deployer}\n`);

  if (Number(chainId) === 31337) {
    const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
    const { walletClient: anvilWallet } = createClients(rpc, ANVIL_KEY);
    const balance = await publicClient.getBalance({ address: deployer });
    const target = parseEther("10");
    if (balance < target) {
      console.log("Funding deployer from Anvil account #0...");
      const hash = await anvilWallet.sendTransaction({ to: deployer, value: target } as never);
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }

  const state: DeployState = readState(chainName) ?? {
    chain: chainName,
    chainId: Number(chainId),
    rpc,
    deployedAt: new Date().toISOString(),
    deployer,
    scopes: {}
  };

  const config = { chain: chainName, rpc, deployer };

  await ensureNickFactory(publicClient, walletClient);

  const scopesToRun = values.scope ? SCOPES.filter((scope) => scope.key === values.scope) : SCOPES;

  for (const { key, fn } of scopesToRun) {
    const existing = state.scopes[key];

    if (existing?.status === "completed" && !values.force) {
      console.log(`Skipping scope "${key}" (already completed)`);
      continue;
    }

    console.log(`\nRunning scope: ${key}`);
    try {
      const result = await fn(publicClient, walletClient, state.scopes, config);
      state.scopes[key] = result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.scopes[key] = { status: "failed", error: message };
      console.error(`Scope "${key}" failed: ${message}`);
    }

    writeState(chainName, state);

    if (state.scopes[key]?.status === "failed") {
      break;
    }
  }

  console.log(`\n---------- Summary: ${chainName} ----------`);
  for (const [key, result] of Object.entries(state.scopes)) {
    console.log(`  ${key}: ${result.status}`);
    if (result.contracts) {
      for (const [name, addr] of Object.entries(result.contracts)) {
        console.log(`      ${name}: ${addr}`);
      }
    }
  }

  const anyFailed = scopesToRun.some(({ key }) => state.scopes[key]?.status === "failed");
  if (anyFailed) {
    console.error(`\nDeploy to ${chainName} FAILED — see the scope errors above.`);
    return false;
  }

  const allCompleted = SCOPES.every(({ key }) => state.scopes[key]?.status === "completed");
  if (allCompleted) {
    // Promotion writes deployments/<name>.json + .ts — what cli/app/host actually read. A deploy
    // whose promotion failed leaves consumers on STALE addresses, so it is fatal, not a warning.
    try {
      promoteDeployment(chainName);
    } catch (error) {
      console.error(
        `\nDeploy to ${chainName} FAILED: contracts landed but the deployment snapshot was NOT promoted ` +
          `(consumers would read stale addresses): ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  return true;
}

async function main() {
  // --all attempts EVERY chain (a failure on one must not hide the others' results), then the
  // process exits 1 if ANY failed.
  if (values.all) {
    let anyFailed = false;
    for (const chain of defaultChains) {
      const ok = await deployToChain(chain.name, chain.rpc);
      anyFailed = anyFailed || !ok;
    }
    if (anyFailed) {
      process.exitCode = 1;
    }
    return;
  }

  if (!values.name) {
    console.error("Error: Provide --name <chain> or --all");
    process.exit(1);
  }

  const defaultChain = defaultChains.find((chain) => chain.name === values.name);
  const rpc = values.rpc ?? defaultChain?.rpc;
  if (!rpc) {
    console.error(`Error: No RPC found for "${values.name}". Provide --rpc or use a default chain.`);
    process.exit(1);
  }

  const ok = await deployToChain(values.name, rpc);
  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
