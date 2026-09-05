import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SuiDeployment, SuiDeploymentName } from "./types.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const deploymentsDir = join(ROOT, "deployments");

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
