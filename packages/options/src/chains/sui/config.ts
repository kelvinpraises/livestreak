// --- exports ---

import type { OptionsChainConfig } from "../types.js";
import type { OptionsSuiObjectIds } from "./addresses.js";

// Shape of the deployment JSON (localnet.json / testnet.json).
// Mirrors SuiDeployment from @livestreak/contracts/sui but accepted as plain data
// so the caller can import the JSON directly without a Node fs read.
type SuiDeploymentData = {
  readonly rpc: string;
  readonly packageId: string;
  readonly objects: {
    readonly packageId: string;
    readonly protocol: string;
    readonly marketRegistry: string;
    readonly vaultRegistry: string;
    readonly stewardRegistry: string;
    readonly treasuryRegistry: string;
    readonly dripsRegistry: string;
    readonly streamsRegistry: string;
    readonly vaultDriverRegistry: string;
    readonly marketDriverRegistry: string;
    readonly driverRegistry: string;
    readonly lvstTreasuryCap?: string;
    readonly usdcMintCap?: string;
    [key: string]: string | undefined;
  };
};

type CreateOptionsSuiConfigInput = {
  readonly deployment: SuiDeploymentData;
  readonly seed: string | Uint8Array;
  readonly rpcUrl?: string;
};

export const createOptionsSuiConfig = (
  input: CreateOptionsSuiConfigInput
): OptionsChainConfig => {
  const { deployment, seed, rpcUrl } = input;
  const effectiveRpc = rpcUrl ?? deployment.rpc;
  const obj = deployment.objects;

  const addresses: OptionsSuiObjectIds = {
    packageId: deployment.packageId as `0x${string}`,
    protocol: obj.protocol as `0x${string}`,
    marketRegistry: obj.marketRegistry as `0x${string}`,
    vaultRegistry: obj.vaultRegistry as `0x${string}`,
    stewardRegistry: obj.stewardRegistry as `0x${string}`,
    treasuryRegistry: obj.treasuryRegistry as `0x${string}`,
    dripsRegistry: obj.dripsRegistry as `0x${string}`,
    streamsRegistry: obj.streamsRegistry as `0x${string}`,
    vaultDriverRegistry: obj.vaultDriverRegistry as `0x${string}`,
    marketDriverRegistry: obj.marketDriverRegistry as `0x${string}`,
    driverRegistry: obj.driverRegistry as `0x${string}`,
    ...(obj.lvstTreasuryCap === undefined ? {} : { lvstTreasuryCap: obj.lvstTreasuryCap as `0x${string}` })
  };

  return {
    walletInit: {
      chain: "sui",
      seedSource: "raw",
      config: { rpcUrl: effectiveRpc }
    },
    seed,
    addresses,
    readRpcUrl: effectiveRpc
  };
};
