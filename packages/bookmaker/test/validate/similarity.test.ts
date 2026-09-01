import { describe, expect, it } from "vitest";
import { validateSimilarityResult } from "../../src/validate/similarity.js";

describe("validateSimilarityResult", () => {
  it("requires candidates to stay scoped to marketId", () => {
    const result = validateSimilarityResult({
      marketId: "market-1",
      candidates: [
        {
          kind: "vault",
          vaultId: "vault-1",
          marketId: "market-2",
          score: 0.9,
          reason: "duplicate question",
          suggestedAction: "join-existing"
        }
      ]
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues).toContain("candidates[0].marketId must match SimilarityResult.marketId");
    }
  });

  it("accepts market-scoped candidates", () => {
    const result = validateSimilarityResult({
      marketId: "market-1",
      candidates: [
        {
          kind: "vault",
          vaultId: "vault-1",
          marketId: "market-1",
          score: 0.9,
          reason: "duplicate question",
          suggestedAction: "join-existing"
        }
      ],
      duplicateRisk: "medium"
    });

    expect(result.ok).toBe(true);
  });
});
