import type { WalletInit } from "@livestreak/schema";

import type { BookmakerContractAddresses } from "../chains/addresses.js";
import type { BookmakerVaultPolicy } from "../decision/choose.js";
import type { BookmakerMarketContext } from "../model/market-context.js";
import type { BookmakerWatchSource } from "../model/watch-source.js";
import type { BookmakerSimilarityClient } from "../similarity/client.js";

// --- exports ---

export interface BookmakerRuntimeConfig {
  readonly runtimeId: string;
  readonly marketContext: BookmakerMarketContext;
  readonly watchSource: BookmakerWatchSource;
  readonly policy: BookmakerVaultPolicy;
  readonly fundingToken: string;
  readonly similarityClient?: BookmakerSimilarityClient;
  readonly walletInit: WalletInit;
  readonly seed: string | Uint8Array;
  readonly addresses: BookmakerContractAddresses;
  readonly readRpcUrl?: string;
  readonly chainId?: number;
}
