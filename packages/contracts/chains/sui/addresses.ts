import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packageRootFrom } from "../package-root.js";
import type { SuiDeployment, SuiDeploymentName } from "./types.js";

// Resolve to the committed SOURCE snapshot (chains/sui/deployments), never a dist copy — a redeploy
// is picked up at runtime without a package rebuild. See chains/package-root.ts.
const deploymentsDir = join(
  packageRootFrom(dirname(fileURLToPath(import.meta.url))),
  "chains",
  "sui",
  "deployments",
);

export const DEFAULT_SUI_DEPLOYMENT: SuiDeploymentName = "localnet";

export function loadDeployment(name: SuiDeploymentName = DEFAULT_SUI_DEPLOYMENT): SuiDeployment {
  const path = join(deploymentsDir, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `Missing Sui deployment snapshot ${path}. Run: npm run deploy:sui -- --name ${name}`,
    );
  }
  return JSON.parse(readFileSync(path, "utf-8")) as SuiDeployment;
}

export function listDeployments(): SuiDeploymentName[] {
  if (!existsSync(deploymentsDir)) return [];
  return readdirSync(deploymentsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, "") as SuiDeploymentName);
}
