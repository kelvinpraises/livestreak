import {
  callerAbi,
  dripsStreamingAbi,
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

import type { EvmContract } from "./types.js";

const assertEvmAbiCoverage = <T extends { readonly [K in EvmContract]: unknown }>(map: T) => map;

export const evmAbis = assertEvmAbiCoverage({
  protocol: protocolAbi,
  marketRegistry: marketRegistryAbi,
  stewardRegistry: stewardRegistryAbi,
  vault: vaultAbi,
  dripsStreaming: dripsStreamingAbi,
  caller: callerAbi,
  marketDriver: marketDriverAbi,
  vaultDriver: vaultDriverAbi,
  treasury: treasuryAbi,
  lvstToken: lvstTokenAbi,
  paymaster: liveStreakPaymasterAbi
});

export type EvmContractAbi<N extends EvmContract> = (typeof evmAbis)[N];
