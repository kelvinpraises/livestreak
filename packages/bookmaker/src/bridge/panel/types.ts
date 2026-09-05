import type { BookmakerDecision } from "../../model/decision.js";
import type { SimilarityResult } from "../../model/similarity.js";
import type { Detection } from "../../model/detection.js";
import type { VaultDraft } from "../../model/vault-draft.js";
import type { BookmakerWriteIntent } from "../../model/write-intent.js";
import type { CreateVaultResult } from "../../chains/types.js";
import type { BookmakerMarketContext } from "../../model/market-context.js";
import type { BookmakerWatchSource } from "../../model/watch-source.js";

// --- exports ---

export type { BookmakerPanelView } from "../../model/watch-source.js";

export interface BookmakerPanelSnapshot {
  readonly runtimeId: string;
  readonly marketContext: BookmakerMarketContext;
  readonly watchSource?: BookmakerWatchSource;
  readonly latestDetection?: Detection;
  readonly currentDraft?: VaultDraft;
  readonly similarityResult?: SimilarityResult;
  readonly lastDecision?: BookmakerDecision;
  readonly pendingWriteIntents?: readonly BookmakerWriteIntent[];
  readonly completedVaultCreations?: readonly {
    readonly intent: Extract<BookmakerWriteIntent, { readonly action: "createVault" }>;
    readonly result: CreateVaultResult;
  }[];
  readonly lastError?: string;
  readonly updatedAtMs?: number;
}
