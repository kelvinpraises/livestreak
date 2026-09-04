import type { BookmakerDecision } from "../model/decision.js";
import type { Detection } from "../model/detection.js";
import type { SimilarityResult } from "../model/similarity.js";
import type { VaultDraft } from "../model/vault-draft.js";
import { idempotencyKeyFromDraft } from "../model/idempotency.js";
import { validateVaultDraft } from "../validate/vault-draft.js";

// --- exports ---

export type BookmakerDuplicatePolicy = "skip-on-high" | "always-create" | "prefer-join";

export interface BookmakerVaultPolicy {
  readonly duplicatePolicy: BookmakerDuplicatePolicy;
  readonly detection: Detection;
  readonly joinScoreThreshold?: number;
}

export const chooseVaultAction = (
  draft: VaultDraft,
  similarity: SimilarityResult,
  policy: BookmakerVaultPolicy
): BookmakerDecision => {
  const draftValidation = validateVaultDraft(draft);
  if (draftValidation.ok === false) {
    return {
      action: "skip",
      reason: "invalid_draft",
      detection: policy.detection
    };
  }

  if (similarity.marketId !== draft.marketId) {
    return {
      action: "skip",
      reason: "market_not_found",
      detection: policy.detection
    };
  }

  if (similarity.stewardWarnings !== undefined && similarity.stewardWarnings.length > 0) {
    return {
      action: "skip",
      reason: "steward_warning",
      detection: policy.detection
    };
  }

  if (policy.duplicatePolicy === "skip-on-high" && similarity.duplicateRisk === "high") {
    return {
      action: "skip",
      reason: "duplicate_vault",
      detection: policy.detection
    };
  }

  const exactMatch = selectExactVaultKeyCandidate(draft, similarity);
  if (exactMatch !== undefined) {
    return {
      action: "joinVault",
      vaultId: exactMatch.vaultId,
      draft,
      detection: policy.detection
    };
  }

  const joinCandidate = selectJoinCandidate(similarity, policy);

  if (joinCandidate !== undefined) {
    return {
      action: "joinVault",
      vaultId: joinCandidate.vaultId,
      draft,
      detection: policy.detection
    };
  }

  return {
    action: "createVault",
    draft,
    detection: policy.detection
  };
};

// --- helpers ---

const selectExactVaultKeyCandidate = (
  draft: VaultDraft,
  similarity: SimilarityResult
) => {
  const draftKey = idempotencyKeyFromDraft(draft);

  return similarity.candidates.find(
    (candidate) =>
      candidate.marketId === similarity.marketId && candidate.vaultKey === draftKey
  );
};

const selectJoinCandidate = (
  similarity: SimilarityResult,
  policy: BookmakerVaultPolicy
) => {
  if (policy.duplicatePolicy === "always-create") {
    return undefined;
  }

  const threshold =
    policy.joinScoreThreshold ??
    (policy.duplicatePolicy === "prefer-join" ? 0.5 : 0.85);

  return similarity.candidates
    .filter(
      (candidate) =>
        candidate.marketId === similarity.marketId &&
        candidate.suggestedAction === "join-existing" &&
        candidate.score >= threshold
    )
    .sort((left, right) => right.score - left.score)[0];
};
