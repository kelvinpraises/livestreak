// --- exports ---

import {
  dripsStreamingAbi,
  lvstTokenAbi,
  marketDriverAbi,
  marketRegistryAbi,
  stewardRegistryAbi,
  treasuryAbi,
  vaultAbi
} from "@livestreak/contracts/evm/abis";

export type OptionsContractAbis = {
  readonly MarketRegistry: typeof marketRegistryAbi;
  readonly Vault: typeof vaultAbi;
  readonly MarketDriver: typeof marketDriverAbi;
  readonly StewardRegistry: typeof stewardRegistryAbi;
  readonly Treasury: typeof treasuryAbi;
  readonly LvstToken: typeof lvstTokenAbi;
  readonly DripsStreaming: typeof dripsStreamingAbi;
};

export const DEFAULT_ABIS: OptionsContractAbis = {
  MarketRegistry: marketRegistryAbi,
  Vault: vaultAbi,
  MarketDriver: marketDriverAbi,
  StewardRegistry: stewardRegistryAbi,
  Treasury: treasuryAbi,
  LvstToken: lvstTokenAbi,
  DripsStreaming: dripsStreamingAbi
};
