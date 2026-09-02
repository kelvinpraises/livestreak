import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Address } from "viem";

import type {
  DeploymentName,
  EvmAddresses,
  EvmContract,
  EvmDeployOutput,
  EvmDeploymentAddresses
} from "./types.js";

const deploymentsDir = join(dirname(fileURLToPath(import.meta.url)), "deployments");

const KNOWN_DEPLOYMENTS = ["localhost"] as const satisfies readonly DeploymentName[];

/** Maps flattened deploy keys to consumer `EvmContract` names (callable proxy addresses). */
const CONTRACT_FROM_DEPLOY_KEY: Readonly<Record<string, EvmContract>> = {
  protocol: "protocol",
  marketRegistry: "marketRegistry",
  stewardRegistry: "stewardRegistry",
  vault: "vault",
  dripsProxy: "dripsStreaming",
  caller: "caller",
  marketDriverProxy: "marketDriver",
  vaultDriver: "vaultDriver",
  treasury: "treasury",
  lvstToken: "lvstToken",
  verifyingPaymaster: "paymaster"
};

const flattenScopes = (output: EvmDeployOutput): EvmDeploymentAddresses => {
  const flat: Record<string, Address> = {
    ...(output.scopes.aa?.contracts ?? {}),
    ...(output.scopes.streaming?.contracts ?? {}),
    ...(output.scopes.protocol?.contracts ?? {}),
    ...(output.scopes.wire?.contracts ?? {}),
    ...(output.scopes.paymaster?.contracts ?? {})
  };

  const mapped: EvmDeploymentAddresses = {};
  for (const [deployKey, address] of Object.entries(flat)) {
    const contract = CONTRACT_FROM_DEPLOY_KEY[deployKey];
    if (contract !== undefined) {
      mapped[contract] = address;
    }
  }
  return mapped;
};

const readDeploymentFile = (name: string): EvmDeployOutput | undefined => {
  const path = join(deploymentsDir, `${name}.json`);
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(path, "utf-8")) as EvmDeployOutput;
  } catch {
    return undefined;
  }
};

const loadDeployment = (name: DeploymentName): EvmDeploymentAddresses => {
  const output = readDeploymentFile(name);
  if (output === undefined) {
    return {};
  }
  return flattenScopes(output);
};

const discoverDeployments = (): DeploymentName[] => {
  if (!existsSync(deploymentsDir)) {
    return [...KNOWN_DEPLOYMENTS];
  }

  const fromDisk = readdirSync(deploymentsDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""))
    .filter((name): name is DeploymentName =>
      (KNOWN_DEPLOYMENTS as readonly string[]).includes(name)
    );

  return fromDisk.length > 0 ? fromDisk : [...KNOWN_DEPLOYMENTS];
};

const buildAddresses = (): EvmAddresses => {
  const result = {} as EvmAddresses;
  for (const name of discoverDeployments()) {
    result[name] = loadDeployment(name);
  }
  return result;
};

/** Typed contract addresses per committed deployment snapshot. */
export const addresses: EvmAddresses = buildAddresses();
