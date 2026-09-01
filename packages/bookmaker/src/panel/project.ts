import type { BookmakerPanelView, BookmakerWatchRef } from "../model/panel.js";
import type { BookmakerDecision } from "../model/decision.js";
import type { BookmakerMarketContext } from "../model/market-context.js";
import type { SimilarityResult } from "../model/similarity.js";
import type { Detection } from "../model/detection.js";
import type { VaultDraft } from "../model/vault-draft.js";
import type { BookmakerWatchSource } from "../model/watch-source.js";
import type { BookmakerWritePlan } from "../model/write-plan.js";

// --- exports ---

export interface BookmakerPanelSnapshot {
  readonly runtimeId: string;
  readonly marketContext: BookmakerMarketContext;
  readonly watchSource?: BookmakerWatchSource;
  readonly latestDetection?: Detection;
  readonly currentDraft?: VaultDraft;
  readonly similarityResult?: SimilarityResult;
  readonly lastDecision?: BookmakerDecision;
  readonly pendingWritePlan?: BookmakerWritePlan;
  readonly completedWritePlans?: readonly BookmakerWritePlan[];
  readonly lastError?: string;
  readonly updatedAtMs?: number;
}

export const projectBookmakerPanel = (snapshot: BookmakerPanelSnapshot): BookmakerPanelView => {
  const watchRefs = projectWatchRefs(snapshot.watchSource);
  const writeIntents = snapshot.pendingWritePlan?.intents ?? [];

  return {
    runtimeId: snapshot.runtimeId,
    marketId: snapshot.marketContext.marketId,
    marketContext: snapshot.marketContext,
    watchRefs,
    ...(snapshot.watchSource === undefined ? {} : { watchSource: snapshot.watchSource }),
    ...(snapshot.latestDetection === undefined ? {} : { latestDetection: snapshot.latestDetection }),
    ...(snapshot.currentDraft === undefined ? {} : { currentDraft: snapshot.currentDraft }),
    similarityCandidates: snapshot.similarityResult?.candidates ?? [],
    ...(snapshot.lastDecision === undefined ? {} : { lastDecision: snapshot.lastDecision }),
    ...(snapshot.lastDecision === undefined
      ? {}
      : { decisionAction: snapshot.lastDecision.action }),
    ...(snapshot.lastDecision?.action === "skip"
      ? { skipReason: snapshot.lastDecision.reason }
      : {}),
    ...(snapshot.pendingWritePlan === undefined ? {} : { pendingWritePlan: snapshot.pendingWritePlan }),
    writeIntents,
    completedWritePlans: snapshot.completedWritePlans ?? [],
    ...(snapshot.lastError === undefined ? {} : { lastError: snapshot.lastError }),
    updatedAtMs: snapshot.updatedAtMs ?? 0
  };
};

// --- helpers ---

const projectWatchRefs = (watchSource: BookmakerWatchSource | undefined): readonly BookmakerWatchRef[] => {
  if (watchSource === undefined) {
    return [];
  }

  const refs: BookmakerWatchRef[] = [];

  if (watchSource.watchUrl !== undefined) {
    refs.push({ kind: "watchUrl", ref: watchSource.watchUrl });
  }

  if (watchSource.webrtcUrl !== undefined) {
    refs.push({ kind: "webrtcUrl", ref: watchSource.webrtcUrl });
  }

  if (watchSource.observationEndpoint !== undefined) {
    refs.push({ kind: "observationEndpoint", ref: watchSource.observationEndpoint });
  }

  if (watchSource.endpointManifestUri !== undefined) {
    refs.push({ kind: "endpointManifestUri", ref: watchSource.endpointManifestUri });
  }

  if (watchSource.cacheReceiptRefs !== undefined) {
    for (const ref of watchSource.cacheReceiptRefs) {
      refs.push({ kind: "cacheReceipt", ref });
    }
  }

  return refs;
};
