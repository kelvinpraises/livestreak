import type { BookmakerDecision, BookmakerSkipReason } from "./decision.js";
import type { BookmakerMarketContext } from "./market-context.js";
import type { SimilarityCandidate } from "./similarity.js";
import type { Detection } from "./detection.js";
import type { VaultDraft } from "./vault-draft.js";
import type { BookmakerWatchSource } from "./watch-source.js";
import type { BookmakerWriteIntent } from "./write-intent.js";
import type { CreateVaultResult } from "../chains/types.js";

// --- exports ---

export type BookmakerWatchRefKind =
  | "watchUrl"
  | "webrtcUrl"
  | "observationEndpoint"
  | "endpointManifestUri"
  | "cacheReceipt";

export interface BookmakerWatchRef {
  readonly kind: BookmakerWatchRefKind;
  readonly ref: string;
}

export interface BookmakerPanelView {
  readonly runtimeId: string;
  readonly marketId: string;
  readonly marketContext: BookmakerMarketContext;
  readonly watchSource?: BookmakerWatchSource;
  readonly watchRefs: readonly BookmakerWatchRef[];
  readonly latestDetection?: Detection;
  readonly currentDraft?: VaultDraft;
  readonly similarityCandidates: readonly SimilarityCandidate[];
  readonly lastDecision?: BookmakerDecision;
  readonly decisionAction?: BookmakerDecision["action"];
  readonly skipReason?: BookmakerSkipReason;
  readonly pendingWriteIntents?: readonly BookmakerWriteIntent[];
  readonly writeIntents: readonly BookmakerWriteIntent[];
  readonly completedVaultCreations: readonly {
    readonly intent: Extract<BookmakerWriteIntent, { readonly action: "createVault" }>;
    readonly result: CreateVaultResult;
  }[];
  readonly lastError?: string;
  readonly updatedAtMs: number;
}
