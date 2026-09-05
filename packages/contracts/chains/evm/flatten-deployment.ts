import type { Address } from "viem";

import type {
  EvmContract,
  EvmDeployOutput,
  EvmDeploymentAddresses,
} from "./types.js";

/** Maps flattened deploy keys to consumer `EvmContract` names (callable proxy addresses). */
const CONTRACT_FROM_DEPLOY_KEY: Readonly<Record<string, EvmContract>> = {
  protocol: "protocol",
  marketRegistry: "marketRegistry",
  stewardRegistry: "stewardRegistry",
  vault: "vault",
  dripsProxy: "dripsStreaming",
  caller: "caller",
  marketDriverProxy: "marketDriver",
  vaultDriver: "vaultDriver",
  treasury: "treasury",
  lvstToken: "lvstToken",
  verifyingPaymaster: "paymaster",
};

export function flattenDeploymentScopes(
  output: EvmDeployOutput,
): EvmDeploymentAddresses {
  const flat: Record<string, Address> = {
    ...(output.scopes.aa?.contracts ?? {}),
    ...(output.scopes.streaming?.contracts ?? {}),
    ...(output.scopes.protocol?.contracts ?? {}),
    ...(output.scopes.wire?.contracts ?? {}),
    ...(output.scopes.paymaster?.contracts ?? {}),
  };

  const mapped: EvmDeploymentAddresses = {};
  for (const [deployKey, address] of Object.entries(flat)) {
    const contract = CONTRACT_FROM_DEPLOY_KEY[deployKey];
    if (contract !== undefined) {
      mapped[contract] = address;
    }
  }
  return mapped;
}
