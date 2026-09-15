/** Node/deploy only — discovers deployments from disk via `node:fs`. */
export {
  addresses as loadAddressesFromDisk,
  loadDeploymentOutput,
  readDeploymentOutputFromPath,
  localhostDeploymentPath,
} from "./addresses.js";
