#!/usr/bin/env tsx
/**
 * LiveStreak host dev server — HTTP on :8787 with AA (embedded Alto bundler + paymaster).
 *
 * Prereqs: anvil + `npm run deploy -- --name localhost` in packages/contracts
 *
 * Run:
 *   npm run dev
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyDeploySnapshotEnv } from "./config/aa/deploy-env.js";
import { bootstrapHostServer } from "./api/server.js";

const HOST_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const DEFAULT_DEPLOY_SNAPSHOT = resolve(
  HOST_ROOT,
  "../packages/contracts/chains/evm/deployments/localhost.json"
);

if (process.env.LIVESTREAK_AA_FROM_DEPLOY !== "0") {
  const snapshotPath = process.env.LIVESTREAK_DEPLOY_SNAPSHOT ?? DEFAULT_DEPLOY_SNAPSHOT;
  try {
    applyDeploySnapshotEnv(snapshotPath);
    console.log(`[host]: AA env from deploy snapshot ${snapshotPath}`);
  } catch (error) {
    console.warn(`[host]: deploy snapshot not loaded (${String(error)}) — set AA env manually`);
  }
}

const { config, deps, app } = await bootstrapHostServer();

app.listen(config.bindPort, config.bindHost, () => {
  console.log(`[host]: listening on http://${config.bindHost}:${config.bindPort}`);
  for (const chain of deps.aa.aa.chains) {
    console.log(
      `  aa/${chain.routeKey} chainId=${chain.chainId} bundler=/aa/bundler/${chain.routeKey} paymaster=/aa/paymaster/${chain.routeKey}`
    );
  }
});
