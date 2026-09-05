import { describe, expect, it } from "vitest";
import { validateObservationEvent } from "../../src/pipeline/observation/validate.js";

describe("validateObservationEvent", () => {
  it("rejects events missing marketId and observationId", () => {
    const result = validateObservationEvent({});

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          "marketId must be a non-empty string",
          "observationId must be a non-empty string",
          "observedAtMs must be a finite number"
        ])
      );
    }
  });

  it("rejects mismatched marketId against the expected feed scope", () => {
    const result = validateObservationEvent(
      {
        marketId: "market-2",
        observationId: "obs-1",
        observedAtMs: 1_000
      },
      "market-1"
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues).toContain("marketId must match the expected observation feed marketId");
    }
  });

  it("accepts a valid market-scoped observation event", () => {
    const result = validateObservationEvent(
      {
        marketId: "market-1",
        observationId: "obs-1",
        observedAtMs: 1_000,
        kind: "frame"
      },
      "market-1"
    );

    expect(result).toEqual({
      ok: true,
      value: {
        marketId: "market-1",
        observationId: "obs-1",
        observedAtMs: 1_000,
        kind: "frame"
      }
    });
  });
});
