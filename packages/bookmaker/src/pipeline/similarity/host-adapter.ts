import { LiveStreakConfigError } from "@livestreak/core";
import type {
  HostSimilarityIndexRequest,
  HostSimilarityRequest,
  HostSimilarityResult,
  HostSimilarityVaultDraft
} from "@livestreak/host";
import type { SimilarityQuery, SimilarityResult } from "../../model/similarity.js";
import type { VaultDraft } from "../../model/vault-draft.js";
import type { ValidationResult } from "../../model/validate.js";
import { validateSimilarityResult } from "../../model/validate.js";
import { validationFailure } from "../../model/validate.js";

// --- exports ---

export const vaultDraftToHostSimilarityDraft = (draft: VaultDraft): HostSimilarityVaultDraft => ({
  title: draft.question.trim(),
  summary: buildHostSummary(draft),
  tags: buildHostTags(draft)
});

export const similarityQueryToHostRequest = (query: SimilarityQuery): HostSimilarityRequest => {
  if (query.vaultDraft.marketId !== query.marketId) {
    throw new LiveStreakConfigError({
      message: "SimilarityQuery.marketId must match vaultDraft.marketId"
    });
  }

  return {
    marketId: query.marketId,
    vaultDraft: vaultDraftToHostSimilarityDraft(query.vaultDraft)
  };
};

export const hostSimilarityResultToBookmaker = (
  result: HostSimilarityResult,
  expectedMarketId: string
): ValidationResult<SimilarityResult> => {
  if (result.marketId !== expectedMarketId) {
    return validationFailure("HostSimilarityResult.marketId must match the bookmaker query marketId");
  }

  // The host echoes an optional `vaultKey` on each candidate (the precomputed
  // dedup key the indexer supplied). `validateCandidate` already reads it off
  // the raw runtime object, so the deterministic exact-match path
  // (`selectExactVaultKeyCandidate`) fires without any extra mapping here — the
  // canonical `@livestreak/host` candidate type just doesn't declare it yet.
  return validateSimilarityResult({
    marketId: result.marketId,
    candidates: result.candidates,
    ...(result.duplicateRisk === undefined ? {} : { duplicateRisk: result.duplicateRisk }),
    ...(result.stewardWarnings === undefined ? {} : { stewardWarnings: result.stewardWarnings })
  });
};

/** Build the discovery-index payload for a created vault (title/summary/tags + dedup key). */
export const vaultIndexRecordToHostRequest = (record: {
  readonly vaultId: string;
  readonly marketId: string;
  readonly draft: VaultDraft;
  readonly vaultKey: string;
}): HostSimilarityIndexRequest & { readonly vaultKey: string } => ({
  vaultId: record.vaultId,
  marketId: record.marketId,
  ...vaultDraftToHostSimilarityDraft(record.draft),
  vaultKey: record.vaultKey
});

// --- helpers ---

const buildHostSummary = (draft: VaultDraft): string => {
  const vaultType = draft.vaultType ?? "vault";
  const expiresAtMs = draft.resolutionWindow.expiresAtMs;
  return `${vaultType} · ${draft.resolutionSource} · expires ${expiresAtMs}`;
};

const buildHostTags = (draft: VaultDraft): string[] => {
  const tags = new Set<string>([draft.outcomeKind]);

  if (draft.vaultType !== undefined) {
    tags.add(draft.vaultType);
  }

  if (draft.creatorSide !== undefined) {
    tags.add(`creator-${draft.creatorSide}`);
  }

  return [...tags];
};
