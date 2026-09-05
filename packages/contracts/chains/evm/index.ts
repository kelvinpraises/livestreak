export {
  callerAbi,
  dripsStreamingAbi,
  iDripsAbi,
  liveStreakPaymasterAbi,
  lvstTokenAbi,
  marketDriverAbi,
  marketRegistryAbi,
  protocolAbi,
  stewardRegistryAbi,
  treasuryAbi,
  vaultAbi,
  vaultDriverAbi
} from "./generated/abis.js";

export { evmAbis as abis } from "./abis.js";
export type { EvmContractAbi } from "./abis.js";

export { addresses } from "./addresses-static.js";
export { localhostDeployment } from "./deployments/localhost.js";

export { contract, DEFAULT_DEPLOYMENT } from "./contract.js";
export type { EvmContractDescriptor } from "./contract.js";

export type {
  DeploymentName,
  EvmAddresses,
  EvmContract,
  EvmDeployOutput,
  EvmDeployScope,
  EvmDeploymentAddresses
} from "./types.js";

export const chain = "evm" as const;
