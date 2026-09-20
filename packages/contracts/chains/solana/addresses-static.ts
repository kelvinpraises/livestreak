// Browser-safe addresses from the committed localnet snapshot (no node:fs).
// Runtime overrides come from env/config at the consumer edge; disk loading lives in node.ts.
import { localnetDeployment } from "./deployments/localnet.js";
import type { SolanaDeployment } from "./types.js";

export const deployment: SolanaDeployment = localnetDeployment;

export const addresses = {
  programId: localnetDeployment.programId,
  usdcMint: localnetDeployment.accounts.usdcMint,
  registry: localnetDeployment.accounts.registry,
  defaultSteward: localnetDeployment.accounts.defaultSteward,
} as const;
