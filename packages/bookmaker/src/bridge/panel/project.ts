import type { BookmakerPanelView, BookmakerWatchRef } from "../../model/panel.js";
import type { BookmakerPanelSnapshot } from "./types.js";

// --- exports ---

export type { BookmakerPanelSnapshot } from "./types.js";

export const projectBookmakerPanel = (snapshot: BookmakerPanelSnapshot): BookmakerPanelView => {
  const watchRefs = projectWatchRefs(snapshot.watchSource);
  const writeIntents = snapshot.pendingWriteIntents ?? [];

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
    writeIntents,
    completedVaultCreations: snapshot.completedVaultCreations ?? [],
    ...(snapshot.lastError === undefined ? {} : { lastError: snapshot.lastError }),
    updatedAtMs: snapshot.updatedAtMs ?? 0
  };
};

// --- helpers ---

const projectWatchRefs = (
  watchSource: BookmakerPanelSnapshot["watchSource"]
): readonly BookmakerWatchRef[] => {
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
