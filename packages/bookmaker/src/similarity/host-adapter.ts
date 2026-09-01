import type {
  HostSimilarityRequest,
  HostSimilarityResult,
  HostSimilarityVaultDraft
} from "@livestreak/host";
import type { SimilarityQuery, SimilarityResult } from "../model/similarity.js";
import type { VaultDraft } from "../model/vault-draft.js";
import type { ValidationResult } from "../validate/result.js";
import { validateSimilarityResult } from "../validate/similarity.js";
import { validationFailure } from "../validate/result.js";

// --- exports ---

export const vaultDraftToHostSimilarityDraft = (draft: VaultDraft): HostSimilarityVaultDraft => ({
  title: draft.question.trim(),
  summary: buildHostSummary(draft),
  tags: buildHostTags(draft)
});

export const similarityQueryToHostRequest = (query: SimilarityQuery): HostSimilarityRequest => {
  if (query.vaultDraft.marketId !== query.marketId) {
    throw new Error("SimilarityQuery.marketId must match vaultDraft.marketId");
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

  return validateSimilarityResult({
    marketId: result.marketId,
    candidates: result.candidates,
    ...(result.duplicateRisk === undefined ? {} : { duplicateRisk: result.duplicateRisk }),
    ...(result.stewardWarnings === undefined ? {} : { stewardWarnings: result.stewardWarnings })
  });
};

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
