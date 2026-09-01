import { describe, expect, it } from "vitest";
import {
  hostSimilarityResultToBookmaker,
  similarityQueryToHostRequest,
  vaultDraftToHostSimilarityDraft
} from "../../src/similarity/host-adapter.js";
import { vaultDraft } from "../helpers/fixtures.js";

describe("similarity host adapter", () => {
  const draft = vaultDraft();

  it("maps vault draft into host similarity request with marketId", () => {
    const request = similarityQueryToHostRequest({ marketId: "market-1", vaultDraft: draft });

    expect(request.marketId).toBe("market-1");
    expect(request.vaultDraft.title).toBe(draft.question);
    expect(request.vaultDraft.tags).toContain("binary");
  });

  it("rejects host results scoped to a different marketId", () => {
    const result = hostSimilarityResultToBookmaker(
      {
        marketId: "market-2",
        candidates: []
      },
      "market-1"
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues[0]).toContain("HostSimilarityResult.marketId must match");
    }
  });

  it("rejects host candidates outside the query marketId", () => {
    const result = hostSimilarityResultToBookmaker(
      {
        marketId: "market-1",
        candidates: [
          {
            kind: "vault",
            vaultId: "vault-1",
            marketId: "market-2",
            score: 0.9,
            reason: "duplicate",
            suggestedAction: "join-existing"
          }
        ]
      },
      "market-1"
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues).toContain("candidates[0].marketId must match SimilarityResult.marketId");
    }
  });

  it("does not add global similarity fields to host draft mapping", () => {
    const hostDraft = vaultDraftToHostSimilarityDraft(draft);

    expect(hostDraft).not.toHaveProperty("globalMarketId");
    expect(hostDraft).not.toHaveProperty("crossMarket");
  });
});
