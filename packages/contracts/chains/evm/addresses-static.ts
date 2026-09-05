import { flattenDeploymentScopes } from "./flatten-deployment.js";
import { localhostDeployment } from "./deployments/localhost.js";
import type { EvmAddresses } from "./types.js";

/** Browser-safe addresses from committed deployment snapshots (no node:fs). */
export const addresses: EvmAddresses = {
  localhost: flattenDeploymentScopes(localhostDeployment),
};
