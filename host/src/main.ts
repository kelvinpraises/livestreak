#!/usr/bin/env tsx
/**
 * LiveStreak host dev server — HTTP on :8787 with AA (bundler proxy + paymaster).
 *
 * Prereqs: anvil + `npm run deploy -- --name localhost` in packages/contracts
 *
 * Run:
 *   npm run dev
 *
 * By default loads AA env from packages/contracts/.../localhost.json when vars are unset.
 * Multi-chain: set LIVESTREAK_AA_CHAINS_FILE to a JSON array (see aa.chains.example.json).
 * Local bundler: run Alto as a sidecar and set bundlerUrl per chain (host does not spawn it).
 */

import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyDeploySnapshotEnv } from "./config/aa/deploy-env.js";
import { bootstrapHostServer, dispatchHttpRequest } from "./interfaces/api/server.js";

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

const { config, deps, routes } = await bootstrapHostServer();

const server = createServer((request, response) => {
  void dispatchHttpRequest(request, response, routes, deps);
});

server.listen(config.bindPort, config.bindHost, () => {
  console.log(`[host]: listening on http://${config.bindHost}:${config.bindPort}`);
  for (const chain of deps.aa.aa.chains) {
    console.log(
      `  aa/${chain.routeKey} chainId=${chain.chainId} bundler=/aa/bundler/${chain.routeKey} paymaster=/aa/paymaster/${chain.routeKey}`
    );
  }
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
