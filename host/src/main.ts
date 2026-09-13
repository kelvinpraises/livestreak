#!/usr/bin/env tsx
/**
 * LiveStreak host dev server — HTTP on :8787 with AA (embedded Alto bundler + paymaster).
 *
 * Prereqs: anvil + `npm run deploy -- --name localhost` in packages/contracts
 *
 * Run:
 *   npm run dev
 */

import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyDeploySnapshotEnv } from "./config/aa/deploy-env.js";
import { bootstrapHostServer } from "./server.js";
import { attachRemoteWss } from "./infrastructure/ws/server.js";
import { readTurnConfig, startTurnServer } from "./services/webrtc/turn.js";

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

// Explicit http.Server so the Remote Bridge Console WSS legs can share the port
// (Express 5 has no built-in WebSocket support).
const httpServer = createServer(app);
attachRemoteWss(httpServer, deps);

// The host IS the WebRTC media relay: embed a STUN/TURN server so producers/viewers behind NAT route media
// through us (no separate coturn). `GET /webrtc/ice` advertises how to reach it. Disable with LIVESTREAK_TURN_ENABLED=0.
const turnConfig = readTurnConfig();
const turn = startTurnServer(turnConfig);

httpServer.listen(config.bindPort, config.bindHost, () => {
  console.log(`[host]: listening on http://${config.bindHost}:${config.bindPort}`);
  if (turn !== null) {
    console.log(
      `  turn/relay listening on 0.0.0.0:${turnConfig.port} relay-ip=${turnConfig.relayIp} realm=${turnConfig.realm} (advertised at GET /webrtc/ice)`
    );
  } else {
    console.log("  turn/relay DISABLED (LIVESTREAK_TURN_ENABLED=0)");
  }
  for (const chain of deps.aa.aa.chains) {
    console.log(
      `  aa/${chain.routeKey} chainId=${chain.chainId} bundler=/aa/bundler/${chain.routeKey} paymaster=/aa/paymaster/${chain.routeKey}`
    );
  }
});

const shutdownTurn = (): void => {
  if (turn !== null) turn.stop();
};
process.once("SIGINT", shutdownTurn);
process.once("SIGTERM", shutdownTurn);
