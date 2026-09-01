import { describe, expect, it } from "vitest";
import { buildObservationSubscriptionInput } from "../../src/observation/context.js";
import { marketContext, watchSource } from "../helpers/fixtures.js";

describe("buildObservationSubscriptionInput", () => {
  it("rejects watch sources scoped to a different marketId", () => {
    const result = buildObservationSubscriptionInput(
      marketContext({ marketId: "market-1" }),
      watchSource({ marketId: "market-2" })
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues[0]).toContain("watchSource.marketId must match marketContext.marketId");
    }
  });

  it("maps watch source and market context into subscription input shape", () => {
    const result = buildObservationSubscriptionInput(marketContext(), watchSource());

    expect(result).toEqual({
      ok: true,
      value: {
        marketId: "market-1",
        observeRunId: "run-1",
        watchUrl: "https://example.com/watch/market-1",
        webrtcUrl: "whep://example.com/market-1",
        endpointManifestUri: "ipfs://manifest-1",
        evidenceRefs: ["evidence-1"]
      }
    });
  });
});
