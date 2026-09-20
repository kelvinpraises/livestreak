// Node-only surface: disk loaders for deployment snapshots (never import from a browser bundle).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packageRootFrom } from "../package-root.js";
import type { SolanaDeployment, SolanaDeploymentName } from "./types.js";

function deploymentsDir(): string {
  const root = packageRootFrom(dirname(fileURLToPath(import.meta.url)));
  return join(root, "chains", "solana", "deployments");
}

export function deploymentPath(name: SolanaDeploymentName): string {
  return join(deploymentsDir(), `${name}.json`);
}

export function loadDeploymentFromDisk(name: SolanaDeploymentName): SolanaDeployment {
  const path = deploymentPath(name);
  if (!existsSync(path)) {
    throw new Error(`solana deployment snapshot missing: ${path} — run npm run deploy:solana`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as SolanaDeployment;
}

export function hasDeployment(name: SolanaDeploymentName): boolean {
  return existsSync(deploymentPath(name));
}
