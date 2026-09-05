// Browser-safe barrel — no node:fs, no deploy tooling, no @mysten/sui runtime.
// For the runtime Sui client + disk loaders use `@livestreak/contracts/sui/node`.
export { localnetDeployment } from "./deployments/localnet.js";

export { MODULES, target } from "./package.js";
export type { LiveStreakModule } from "./package.js";
export { SIDE_YES, SIDE_NO, USDC_ONE } from "./types.js";
export type { BoardView, VaultResolutionView } from "./client.js";
export type {
  SuiDeployment,
  SuiDeploymentName,
  SuiDeployOutput,
  SuiObjectIds,
} from "./types.js";
export {
  CYCLE_SECS,
  OUTCOME_YES,
  OUTCOME_NO,
  RATE,
  SUI_CLOCK_OBJECT_ID,
} from "./types.js";

export const chain = "sui" as const;
