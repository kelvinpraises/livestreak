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

import { packageRootFrom } from "../package-root.js";

// Always resolve to the committed SOURCE snapshot (chains/evm/deployments), never a dist copy — so a
// redeploy is picked up at runtime without a package rebuild. Works whether this module runs from
// source (tsx) or compiled dist, since both walk up to the same package root.
const deploymentsDir = join(
  packageRootFrom(dirname(fileURLToPath(import.meta.url))),
  "chains",
  "evm",
  "deployments",
);

const KNOWN_DEPLOYMENTS = ["localhost"] as const satisfies readonly DeploymentName[];

// Parse a snapshot JSON from an explicit path. THE single EVM snapshot parser: both the name-based
// loader and any host/path override read through this so no consumer hand-rolls its own JSON.parse.
export const readDeploymentOutputFromPath = (path: string): EvmDeployOutput => {
  if (!existsSync(path)) {
    throw new Error(`Missing EVM deployment snapshot ${path}. Run: npm run deploy`);
  }

  try {
    return JSON.parse(readFileSync(path, "utf-8")) as EvmDeployOutput;
  } catch (error) {
    throw new Error(
      `Unparseable EVM deployment snapshot ${path} (${
        error instanceof Error ? error.message : String(error)
      }). Re-run: npm run deploy`,
    );
  }
};

// A missing or corrupt snapshot for a SPECIFICALLY requested deployment is fatal-with-instructions
// (mirrors chains/sui/addresses.ts): silently returning {} handed consumers empty addresses that
// only failed far downstream (dead-vaultDriver class of bugs).
const readDeploymentFile = (name: string): EvmDeployOutput => {
  const path = join(deploymentsDir, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `Missing EVM deployment snapshot ${path}. Run: npm run deploy -- --name ${name}`,
    );
  }
  return readDeploymentOutputFromPath(path);
};

const loadDeployment = (name: DeploymentName): EvmDeploymentAddresses =>
  flattenDeploymentScopes(readDeploymentFile(name));

// The committed localhost snapshot's on-disk path — host uses this as the default snapshot path so
// there is exactly ONE source of truth for "where the localhost deployment lives".
export const localhostDeploymentPath = (): string => join(deploymentsDir, "localhost.json");

/** Raw deployment snapshot (rpc + full scopes) read fresh from disk — Node consumers that need the
 * un-flattened AA/protocol scopes or rpc read this at runtime so stale compiled .ts can never serve
 * dead addresses (the generated .ts stays browser-only). */
export const loadDeploymentOutput = (
  name: DeploymentName = "localhost",
): EvmDeployOutput => readDeploymentFile(name);

// Directory-listing stays lenient: an absent deployments dir (or none of the known snapshots on
// disk) just lists the known names — the throw belongs to LOADING a specific deployment.
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

// Lazy per-deployment accessors: this module is imported eagerly, so an absent snapshot must not
// break consumers that never touch that deployment — the load (and its actionable throw) happens on
// FIRST ACCESS of addresses[name], then caches.
const buildAddresses = (): EvmAddresses => {
  const result = {} as EvmAddresses;
  for (const name of discoverDeployments()) {
    let cached: EvmDeploymentAddresses | undefined;
    Object.defineProperty(result, name, {
      enumerable: true,
      get: (): EvmDeploymentAddresses => {
        cached ??= loadDeployment(name);
        return cached;
      },
    });
  }
  return result;
};

/** Typed contract addresses per committed deployment snapshot (loaded lazily, throws on access if absent). */
export const addresses: EvmAddresses = buildAddresses();
