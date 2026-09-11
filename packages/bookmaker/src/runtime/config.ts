import type { WalletInit } from "@livestreak/schema";

import type { BookmakerContractAddresses, BookmakerSuiObjectIds } from "../chains/addresses.js";
import type { BookmakerVaultPolicy } from "../pipeline/decision/choose.js";
import type { BookmakerMarketContext } from "../model/market-context.js";
import type { BookmakerWatchSource } from "../model/watch-source.js";
import type { BookmakerSimilarityClient } from "../pipeline/similarity/client.js";

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
  readonly addresses: BookmakerContractAddresses | BookmakerSuiObjectIds;
  readonly readRpcUrl?: string;
  readonly chainId?: number;
}
