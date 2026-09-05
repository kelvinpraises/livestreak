import { createPublicClient, createWalletClient, http, encodeAbiParameters, keccak256, toHex, parseEther, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { join, resolve } from "path";

export const DETERMINISTIC_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address;

const NICK_FACTORY_DEPLOYER = "0x3fab184622dc19b6109349b94811493bf2a45362" as Address;
const NICK_FACTORY_RAW_TX =
  "0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8152600101602090f31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222" as Hex;

export async function ensureNickFactory(
  publicClient: PublicClient,
  walletClient: WalletClient
): Promise<void> {
  const code = await publicClient.getCode({ address: DETERMINISTIC_DEPLOYER });
  if (code && code !== "0x") {
    return;
  }

  console.log("Nick factory not found — deploying...");

  const fundHash = await walletClient.sendTransaction({
    to: NICK_FACTORY_DEPLOYER,
    value: parseEther("0.01")
  } as never);
  await publicClient.waitForTransactionReceipt({ hash: fundHash });

  const deployHash = await publicClient.request({
    method: "eth_sendRawTransaction",
    params: [NICK_FACTORY_RAW_TX]
  });
  await publicClient.waitForTransactionReceipt({ hash: deployHash as Hex });

  const deployed = await publicClient.getCode({ address: DETERMINISTIC_DEPLOYER });
  if (!deployed || deployed === "0x") {
    throw new Error("Failed to deploy nick's factory");
  }

  console.log("Nick factory deployed\n");
}

export function labelSalt(label: string): Hex {
  return keccak256(toHex(label));
}

export function computeCreate2Address(salt: Hex, initcode: Hex): Address {
  const initcodeHash = keccak256(initcode);
  const factory = DETERMINISTIC_DEPLOYER.slice(2).toLowerCase();
  const payload = `0xff${factory}${salt.slice(2)}${initcodeHash.slice(2)}`;
  const hash = keccak256(payload as Hex);
  return `0x${hash.slice(26)}` as Address;
}

export type ScopeResult = {
  status: "completed" | "failed";
  deployedAt?: string;
  contracts?: Record<string, string>;
  error?: string;
};

export type DeployState = {
  chain: string;
  chainId: number;
  rpc: string;
  deployedAt: string;
  deployer: string;
  scopes: Record<string, ScopeResult>;
};

export type ScopeFn = (
  client: PublicClient,
  walletClient: WalletClient,
  previousScopes: Record<string, ScopeResult>,
  config: { chain: string; rpc: string; deployer: Address }
) => Promise<ScopeResult>;

export function createClients(rpc: string, deployerKey: Hex) {
  const account = privateKeyToAccount(deployerKey);
  const transport = http(rpc);
  const publicClient = createPublicClient({ transport });
  const walletClient = createWalletClient({ account, transport });
  return { publicClient, walletClient, account };
}

const CONTRACTS_ROOT = resolve(import.meta.dirname, "..");
const OUTPUT_DIR = resolve(import.meta.dirname, "output");

export async function isDeployed(client: PublicClient, address: Address): Promise<boolean> {
  const code = await client.getCode({ address });
  return !!code && code !== "0x";
}

export function artifactExists(artifactPath: string): boolean {
  return existsSync(join(CONTRACTS_ROOT, artifactPath));
}

function buildInitcode(
  artifact: { bytecode: { object: Hex }; abi: readonly { type: string; inputs?: readonly unknown[] }[] },
  constructorArgs?: readonly unknown[],
  libraries?: Record<string, Address>
): Hex {
  let bytecode: Hex = artifact.bytecode.object;

  if (libraries) {
    for (const addr of Object.values(libraries)) {
      const clean = addr.slice(2).toLowerCase();
      bytecode = bytecode.replace(new RegExp(`__\\$[a-f0-9]{34}\\$__`, "g"), clean) as Hex;
    }
  }

  if (!constructorArgs || constructorArgs.length === 0) {
    return bytecode;
  }

  const ctorInputs = artifact.abi.filter((entry: { type: string }) => entry.type === "constructor")[0]?.inputs ?? [];
  const encoded = encodeAbiParameters(ctorInputs as never, constructorArgs as never);
  return (bytecode + encoded.slice(2)) as Hex;
}

export async function deployFromArtifact(
  walletClient: WalletClient,
  publicClient: PublicClient,
  artifactPath: string,
  constructorArgs?: readonly unknown[],
  libraries?: Record<string, Address>,
  label?: string
): Promise<Address> {
  const fullPath = join(CONTRACTS_ROOT, artifactPath);
  const artifact = JSON.parse(readFileSync(fullPath, "utf-8"));
  const initcode = buildInitcode(artifact, constructorArgs, libraries);

  const salt = labelSalt(label ?? artifactPath);
  const predicted = computeCreate2Address(salt, initcode);

  if (await isDeployed(publicClient, predicted)) {
    console.log(`  ${label ?? artifactPath} already at ${predicted}`);
    return predicted;
  }

  const hash = await walletClient.sendTransaction({
    to: DETERMINISTIC_DEPLOYER,
    data: (salt + initcode.slice(2)) as Hex
  } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.status || receipt.status === "reverted") {
    throw new Error(`CREATE2 deploy failed for ${label ?? artifactPath}`);
  }

  if (!(await isDeployed(publicClient, predicted))) {
    throw new Error(`CREATE2 deploy did not land at predicted address ${predicted}`);
  }

  console.log(`  Deployed ${label ?? artifactPath} -> ${predicted}`);
  return predicted;
}

export function readState(name: string): DeployState | null {
  const filePath = join(OUTPUT_DIR, `${name}.json`);
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, "utf-8")) as DeployState;
}

export function writeState(name: string, state: DeployState): void {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const filePath = join(OUTPUT_DIR, `${name}.json`);
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`  State saved -> ${filePath}`);
}

/** Copy a fresh deploy output into the committed `deployments/` snapshot for the typed kit. */
export function promoteDeployment(name: string): void {
  const source = join(OUTPUT_DIR, `${name}.json`);
  if (!existsSync(source)) {
    throw new Error(`Cannot promote: missing deploy output at ${source}`);
  }

  const destDir = join(CONTRACTS_ROOT, "deployments");
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  const dest = join(destDir, `${name}.json`);
  copyFileSync(source, dest);
  console.log(`  Promoted deployment -> ${dest}`);

  const snapshot = JSON.parse(readFileSync(dest, "utf-8")) as {
    chain: string;
    chainId: number;
    rpc: string;
    deployedAt: string;
    deployer: string;
    scopes: Record<string, unknown>;
  };
  writeDeploymentTs(name, snapshot);
}

/** Write a browser-safe typed TypeScript const alongside the JSON snapshot. */
function writeDeploymentTs(
  name: string,
  snapshot: {
    chain: string;
    chainId: number;
    rpc: string;
    deployedAt: string;
    deployer: string;
    scopes: Record<string, unknown>;
  },
): void {
  const varName = `${name}Deployment`;
  const scopesJson = JSON.stringify(snapshot.scopes, null, 2)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  const ts = [
    "// Auto-generated by deploy — do not edit by hand.",
    `// Re-run promote after deploy to regenerate from the latest ${name} snapshot.`,
    'import type { EvmDeployOutput } from "../types.js";',
    "",
    `export const ${varName}: EvmDeployOutput = {`,
    `  chain: "${snapshot.chain}",`,
    `  chainId: ${snapshot.chainId},`,
    `  rpc: "${snapshot.rpc}",`,
    `  deployedAt: "${snapshot.deployedAt}",`,
    `  deployer: "${snapshot.deployer}",`,
    `  scopes: ${scopesJson.trimStart()},`,
    "};",
    "",
  ].join("\n");
  writeFileSync(join(CONTRACTS_ROOT, "deployments", `${name}.ts`), ts);
}
