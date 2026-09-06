import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient, type SuiObjectChange } from "@mysten/sui/jsonRpc";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Transaction, type TransactionArgument } from "@mysten/sui/transactions";
import type { SuiDeployOutput, SuiDeployment, SuiDeploymentName, SuiObjectIds } from "../types.js";

const SUI_ROOT = dirname(fileURLToPath(import.meta.url));
export const CONTRACTS_SUI_ROOT = dirname(SUI_ROOT);
export const DEPLOYMENTS_DIR = join(CONTRACTS_SUI_ROOT, "deployments");
export const OUTPUT_DIR = join(CONTRACTS_SUI_ROOT, "deploy", "output");

export const LOCALNET_RPC = "http://127.0.0.1:9000";
export const TESTNET_RPC = "https://fullnode.testnet.sui.io:443";
export const LOCALNET_FAUCET = "http://127.0.0.1:9123/gas";
export const TESTNET_FAUCET = "https://faucet.testnet.sui.io/gas";

export const DEFAULT_RPC = process.env.SUI_RPC ?? LOCALNET_RPC;
export const DEFAULT_FAUCET = process.env.SUI_FAUCET ?? LOCALNET_FAUCET;

export function rpcForDeployment(name: SuiDeploymentName): string {
  if (process.env.SUI_RPC) return process.env.SUI_RPC;
  if (name === "testnet") return TESTNET_RPC;
  if (name === "mainnet") return "https://fullnode.mainnet.sui.io:443";
  return LOCALNET_RPC;
}

export function faucetForRpc(rpc: string): string {
  if (process.env.SUI_FAUCET) return process.env.SUI_FAUCET;
  if (rpc.includes("testnet")) return TESTNET_FAUCET;
  return LOCALNET_FAUCET;
}

export function networkForDeployment(name: SuiDeploymentName): "localnet" | "testnet" | "mainnet" {
  if (name === "testnet") return "testnet";
  if (name === "mainnet") return "mainnet";
  return "localnet";
}

export function ensureDirs(): void {
  mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

export function moveBuild(): void {
  const prev = execSync("sui client active-env", { encoding: "utf-8" }).trim();
  try {
    if (prev !== "testnet") execSync("sui client switch --env testnet", { stdio: "ignore" });
    execSync("sui move build -e testnet", { cwd: CONTRACTS_SUI_ROOT, stdio: "inherit" });
  } finally {
    if (prev !== "testnet") execSync(`sui client switch --env ${prev}`, { stdio: "ignore" });
  }
}

export function dumpBytecode(): { modules: string[]; dependencies: string[] } {
  const prev = execSync("sui client active-env", { encoding: "utf-8" }).trim();
  try {
    if (prev !== "testnet") execSync("sui client switch --env testnet", { stdio: "ignore" });
    const buildJson = execSync(
      "sui move build -e testnet --dump-bytecode-as-base64 --with-unpublished-dependencies",
      { cwd: CONTRACTS_SUI_ROOT, encoding: "utf-8" },
    );
    return JSON.parse(buildJson) as { modules: string[]; dependencies: string[] };
  } finally {
    if (prev !== "testnet") execSync(`sui client switch --env ${prev}`, { stdio: "ignore" });
  }
}

export function getKeypair(): Ed25519Keypair {
  const secret = process.env.SUI_SECRET_KEY;
  if (secret) {
    const { secretKey } = decodeSuiPrivateKey(secret);
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  if (process.env.SUI_MNEMONIC) {
    return Ed25519Keypair.deriveKeypair(process.env.SUI_MNEMONIC);
  }
  try {
    const active = execSync("sui client active-address", { encoding: "utf-8" }).trim();
    const raw = execSync(`sui keytool export --key-identity ${active} --json`, {
      encoding: "utf-8",
    }).trim();
    const parsed = JSON.parse(raw) as { exportedPrivateKey?: string };
    const exported = parsed.exportedPrivateKey ?? raw;
    const { secretKey } = decodeSuiPrivateKey(exported);
    return Ed25519Keypair.fromSecretKey(secretKey);
  } catch {
    // Hardcoded mnemonic is a localnet-only DX convenience. Refuse it on any real network so a
    // missing key can never silently sign a testnet/mainnet transaction with a well-known seed.
    const activeEnv = (() => {
      try {
        return execSync("sui client active-env", { encoding: "utf-8" }).trim();
      } catch {
        return "";
      }
    })();
    if (activeEnv !== "localnet") {
      throw new Error(
        `getKeypair: no SUI_SECRET_KEY/SUI_MNEMONIC and no exportable active key on env "${activeEnv}". ` +
          "The hardcoded mnemonic fallback is permitted on localnet only — set SUI_SECRET_KEY to deploy here.",
      );
    }
    const mnemonic =
      "cargo town galaxy wonder animal digital buddy member object detect home chapter";
    return Ed25519Keypair.deriveKeypair(mnemonic);
  }
}

function parsePublishJson(raw: string): { packageId: string; objectChanges: SuiObjectChange[] } {
  const match = raw.match(/\{\s*"digest"/);
  const start = match?.index ?? -1;
  if (start < 0) throw new Error(`publish produced no JSON:\n${raw.slice(-2000)}`);
  const parsed = JSON.parse(raw.slice(start)) as {
    objectChanges?: SuiObjectChange[];
  };
  const packageId = findPublishedPackageId(parsed.objectChanges);
  return { packageId, objectChanges: parsed.objectChanges ?? [] };
}

export function cliTestPublish(force = false): { packageId: string; objectChanges: SuiObjectChange[] } {
  const pubFile = join(CONTRACTS_SUI_ROOT, "Pub.localnet.toml");
  if (force && existsSync(pubFile)) rmSync(pubFile);
  const prev = execSync("sui client active-env", { encoding: "utf-8" }).trim();
  try {
    if (prev !== "localnet") execSync("sui client switch --env localnet", { stdio: "ignore" });
    const raw = execSync(
      "sui client test-publish --build-env testnet --publish-unpublished-deps --gas-budget 3000000000 --json 2>/dev/null",
      { cwd: CONTRACTS_SUI_ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
    );
    return parsePublishJson(raw);
  } finally {
    if (prev !== "localnet") execSync(`sui client switch --env ${prev}`, { stdio: "ignore" });
  }
}

export function cliPublish(
  network: "localnet" | "testnet",
  force = false,
): { packageId: string; objectChanges: SuiObjectChange[] } {
  if (network === "localnet") return cliTestPublish(force);
  const prev = execSync("sui client active-env", { encoding: "utf-8" }).trim();
  try {
    if (prev !== "testnet") execSync("sui client switch --env testnet", { stdio: "ignore" });
    const raw = execSync(
      "sui client publish --with-unpublished-dependencies --gas-budget 3000000000 --json 2>/dev/null",
      { cwd: CONTRACTS_SUI_ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
    );
    return parsePublishJson(raw);
  } finally {
    if (prev !== "testnet") execSync(`sui client switch --env ${prev}`, { stdio: "ignore" });
  }
}

export function makeClient(
  rpc = DEFAULT_RPC,
  network: "localnet" | "testnet" | "mainnet" = "localnet",
): SuiJsonRpcClient {
  return new SuiJsonRpcClient({ url: rpc, network });
}

export function readState(name: SuiDeploymentName): SuiDeployOutput | null {
  const path = join(OUTPUT_DIR, `${name}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as SuiDeployOutput;
}

export function writeState(name: SuiDeploymentName, state: SuiDeployOutput): void {
  ensureDirs();
  writeFileSync(join(OUTPUT_DIR, `${name}.json`), JSON.stringify(state, null, 2));
}

export function promoteDeployment(name: SuiDeploymentName, state: SuiDeployOutput): void {
  if (state.status !== "completed" || !state.packageId) {
    throw new Error("Cannot promote incomplete deployment");
  }
  const objects = state.objects as SuiObjectIds;
  const snapshot: SuiDeployment = {
    chain: name,
    rpc: state.rpc,
    deployedAt: state.deployedAt,
    deployer: state.deployer,
    packageId: state.packageId,
    objects,
  };
  writeFileSync(join(DEPLOYMENTS_DIR, `${name}.json`), JSON.stringify(snapshot, null, 2));
  writeDeploymentTs(name, snapshot);
}

/** Write a browser-safe typed TypeScript const alongside the JSON snapshot. */
export function writeDeploymentTs(name: SuiDeploymentName, snapshot: SuiDeployment): void {
  const varName = `${name}Deployment`;
  const objectsLines = Object.entries(snapshot.objects)
    .map(([k, v]) => `    ${k}: "${v}",`)
    .join("\n");
  const ts = [
    `// Auto-generated by deploy:sui — do not edit by hand.`,
    `// Re-run \`npm run deploy:sui\` to regenerate from the latest ${name} deployment.`,
    `import type { SuiDeployment } from "../types.js";`,
    ``,
    `export const ${varName}: SuiDeployment = {`,
    `  chain: "${snapshot.chain}",`,
    `  rpc: "${snapshot.rpc}",`,
    `  deployedAt: "${snapshot.deployedAt}",`,
    `  deployer: "${snapshot.deployer}",`,
    `  packageId: "${snapshot.packageId}",`,
    `  objects: {`,
    objectsLines,
    `  },`,
    `};`,
    ``,
  ].join("\n");
  writeFileSync(join(DEPLOYMENTS_DIR, `${name}.ts`), ts);
}

export function findCreatedId(
  changes: SuiObjectChange[] | undefined,
  typeSuffix: string,
  packageId?: string,
): string | undefined {
  if (!changes) return undefined;
  for (const change of changes) {
    if (change.type !== "created") continue;
    const ty = change.objectType ?? "";
    if (!ty.includes(typeSuffix)) continue;
    if (packageId && !ty.startsWith(packageId)) continue;
    return change.objectId;
  }
  return undefined;
}

export function requireCreatedId(
  changes: SuiObjectChange[] | undefined,
  typeSuffix: string,
  packageId?: string,
): string {
  const id = findCreatedId(changes, typeSuffix, packageId);
  if (!id) throw new Error(`Expected created object matching ${typeSuffix}`);
  return id;
}

export function bytesArg(tx: Transaction, data: Uint8Array): TransactionArgument {
  return tx.pure.vector("u8", Array.from(data));
}

export function u64Arg(tx: Transaction, value: bigint | number): TransactionArgument {
  return tx.pure.u64(value);
}

export async function requestGas(
  client: SuiJsonRpcClient,
  address: string,
  faucet = DEFAULT_FAUCET,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(faucet, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ FixedAmountRequest: { recipient: address } }),
      });
      if (res.ok) await new Promise((r) => setTimeout(r, 800));
    } catch {
      /* faucet optional */
    }
  }
  void client;
}

export function findPublishedPackageId(changes: SuiObjectChange[] | null | undefined): string {
  if (!changes) throw new Error("No object changes from publish");
  for (const change of changes) {
    if (change.type === "published") return change.packageId;
  }
  throw new Error("Published packageId not found");
}
