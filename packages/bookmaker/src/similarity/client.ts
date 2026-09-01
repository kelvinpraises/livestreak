import type { SimilarityQuery, SimilarityResult } from "../model/similarity.js";

// --- exports ---

export interface BookmakerSimilarityClient {
  readonly findSimilar: (query: SimilarityQuery) => Promise<SimilarityResult>;
}
