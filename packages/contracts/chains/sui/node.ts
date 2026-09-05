/** Node/deploy only — reads deployment JSON from disk via `node:fs`, and the runtime
 * Sui client (depends on the @mysten/sui jsonRpc runtime; never import into a browser bundle). */
export {
  DEFAULT_SUI_DEPLOYMENT,
  listDeployments,
  loadDeployment,
} from "./addresses.js";

export { LiveStreakSuiClient } from "./client.js";
export type { BoardView, VaultResolutionView } from "./client.js";
