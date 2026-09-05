import { flattenDeploymentScopes } from "./flatten-deployment.js";
import type {
  DeploymentName,
  EvmAddresses,
  EvmDeployOutput,
  EvmDeploymentAddresses,
} from "./types.js";

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const deploymentsDir = join(dirname(fileURLToPath(import.meta.url)), "deployments");

const KNOWN_DEPLOYMENTS = ["localhost"] as const satisfies readonly DeploymentName[];

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
  return flattenDeploymentScopes(output);
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
