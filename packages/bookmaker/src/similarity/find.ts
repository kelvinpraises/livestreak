import type { SimilarityResult } from "../model/similarity.js";
import type { VaultDraft } from "../model/vault-draft.js";
import type { BookmakerSimilarityClient } from "./client.js";

// --- exports ---

export const findSimilar = (
  draft: VaultDraft,
  client: BookmakerSimilarityClient
): Promise<SimilarityResult> =>
  client.findSimilar({
    marketId: draft.marketId,
    vaultDraft: draft
  });
