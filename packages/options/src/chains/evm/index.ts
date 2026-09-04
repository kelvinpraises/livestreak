// --- exports ---

import type { OptionsChain, OptionsChainConfig } from "../types.js";
import { createEvmOptionsReader } from "./reader.js";
import { createEvmOptionsWriter } from "./writer.js";

export const createEvmOptionsChain = (config: OptionsChainConfig): OptionsChain => ({
  reader: createEvmOptionsReader(config),
  writer: createEvmOptionsWriter(config)
});

export type { OptionsContractAddresses } from "./addresses.js";
export { validateOptionsContractAddresses } from "./addresses.js";
export type { OptionsContractAbis } from "./abis.js";
export { DEFAULT_ABIS } from "./abis.js";
export {
  contractsReadFailed,
  contractsReadNotFound,
  type ContractsReadEntity
} from "./decode.js";
