import { flattenDeploymentScopes } from "./flatten-deployment.js";
import { localhostDeployment } from "./deployments/localhost.js";
import { arbitrum_sepoliaDeployment } from "./deployments/arbitrum-sepolia.js";
import { monad_testnetDeployment } from "./deployments/monad-testnet.js";
import type { EvmAddresses } from "./types.js";

/** Browser-safe addresses from committed deployment snapshots (no node:fs). */
export const addresses: EvmAddresses = {
  localhost: flattenDeploymentScopes(localhostDeployment),
  "arbitrum-sepolia": flattenDeploymentScopes(arbitrum_sepoliaDeployment),
  "monad-testnet": flattenDeploymentScopes(monad_testnetDeployment),
};
