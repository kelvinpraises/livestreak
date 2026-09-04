// --- exports ---

import type { BookmakerChain, BookmakerChainConfig } from "../types.js";
import { createEvmBookmakerReader } from "./reader.js";
import { createEvmBookmakerWriter } from "./writer.js";

export const createEvmBookmakerChain = (config: BookmakerChainConfig): BookmakerChain => ({
  reader: createEvmBookmakerReader(config),
  writer: createEvmBookmakerWriter(config)
});

export type { BookmakerContractAddresses } from "../addresses.js";
export { validateBookmakerContractAddresses } from "./addresses.js";
export { parseVaultCreatedFromLogs } from "./decode.js";
