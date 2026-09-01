import type { BookmakerSimilarityClient } from "../../src/similarity/client.js";
import type { SimilarityResult } from "../../src/index.js";

// --- exports ---

export const createFakeSimilarityClient = (
  result: SimilarityResult
): BookmakerSimilarityClient => ({
  findSimilar: async (query) => {
    if (query.marketId !== result.marketId) {
      return {
        marketId: query.marketId,
        candidates: []
      };
    }

    return result;
  }
});

export const createRejectingSimilarityClient = (
  error: Error = new Error("host similarity unavailable")
): BookmakerSimilarityClient => ({
  findSimilar: async () => Promise.reject(error)
});
