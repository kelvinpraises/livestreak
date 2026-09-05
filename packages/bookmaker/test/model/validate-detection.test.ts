import { describe, expect, it } from "vitest";
import { validateDetection } from "../../src/model/validate.js";

describe("validateDetection", () => {
  it("rejects invalid confidence and duration", () => {
    const result = validateDetection({
      detectorId: "",
      confidence: 1.5,
      question: "",
      vaultType: "",
      durationSeconds: 0
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          "detectorId must be a non-empty string",
          "confidence must be between 0 and 1",
          "question must be a non-empty string",
          "vaultType must be a non-empty string",
          "durationSeconds must be a positive finite number"
        ])
      );
    }
  });

  it("accepts a valid detection", () => {
    const result = validateDetection({
      detectorId: "momentum",
      confidence: 0.9,
      question: "Will Team A score?",
      vaultType: "momentum",
      durationSeconds: 600
    });

    expect(result.ok).toBe(true);
  });
});
