import { describe, expect, it } from "vitest";
import { validateBookmakerMarketContext } from "../../src/model/validate.js";

describe("validateBookmakerMarketContext", () => {
  it("rejects missing marketId, observeRunId, and observer", () => {
    const result = validateBookmakerMarketContext({});

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          "marketId must be a non-empty string",
          "observeRunId must be a non-empty string",
          "observer must be a non-empty string"
        ])
      );
    }
  });

  it("rejects invalid optional fields", () => {
    const result = validateBookmakerMarketContext({
      marketId: "market-1",
      observeRunId: "run-1",
      observer: "0xabc",
      startedAtMs: Number.NaN,
      evidenceRefs: [""]
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          "startedAtMs must be a finite number when provided",
          "evidenceRefs[0] must be a non-empty string"
        ])
      );
    }
  });

  it("rejects an empty marketId by default", () => {
    const result = validateBookmakerMarketContext({
      marketId: "",
      observeRunId: "run-1",
      observer: "0xabc"
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues).toContain("marketId must be a non-empty string");
    }
  });

  it("accepts an empty marketId as the unconfigured state when allowed", () => {
    const result = validateBookmakerMarketContext(
      { marketId: "", observeRunId: "run-1", observer: "0xabc" },
      { allowUnconfigured: true }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.marketId).toBe("");
    }
  });

  it("still rejects a missing (non-string) marketId even when unconfigured is allowed", () => {
    const result = validateBookmakerMarketContext(
      { observeRunId: "run-1", observer: "0xabc" },
      { allowUnconfigured: true }
    );

    expect(result.ok).toBe(false);
  });

  it("accepts a valid market context", () => {
    const result = validateBookmakerMarketContext({
      marketId: "market-1",
      observeRunId: "run-1",
      observer: "0xabc",
      title: "Derby"
    });

    expect(result).toEqual({
      ok: true,
      value: {
        marketId: "market-1",
        observeRunId: "run-1",
        observer: "0xabc",
        title: "Derby"
      }
    });
  });
});
