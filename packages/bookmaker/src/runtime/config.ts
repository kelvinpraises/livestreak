import type { BookmakerVaultPolicy } from "../decision/choose.js";
import type { BookmakerMarketContext } from "../model/market-context.js";
import type { BookmakerContractsSurface } from "../model/write-plan.js";
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
  readonly contracts?: BookmakerContractsSurface;
  readonly chainId?: number;
}
