import type { VaultDraft } from "./vault-draft.js";

// --- exports ---

export interface SimilarityQuery {
  readonly marketId: string;
  readonly vaultDraft: VaultDraft;
}

export interface SimilarityCandidate {
  readonly kind: "vault";
  readonly vaultId: string;
  readonly marketId: string;
  readonly score: number;
  readonly reason: string;
  readonly suggestedAction: "join-existing" | "create-new" | "skip";
}

export interface SimilarityResult {
  readonly marketId: string;
  readonly candidates: readonly SimilarityCandidate[];
  readonly duplicateRisk?: "low" | "medium" | "high";
  readonly stewardWarnings?: readonly string[];
}
