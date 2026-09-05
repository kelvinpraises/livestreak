import { describe, expect, it } from "vitest";
import { detectOpportunity } from "../../src/pipeline/detection/evaluate.js";
import type { PatternDetector } from "../../src/pipeline/detection/types.js";
import { detection, marketContext } from "../helpers/fixtures.js";

describe("detectOpportunity", () => {
  const nowMs = 5_000;
  const context = marketContext();
  const baseInput = {
    marketContext: context,
    events: [
      {
        marketId: "market-1",
        observationId: "obs-1",
        observedAtMs: nowMs,
        kind: "signal"
      }
    ],
    policy: { confidenceThreshold: 0.8 },
    nowMs
  } as const;

  it("skips when no detectors are configured", () => {
    const result = detectOpportunity({
      ...baseInput,
      detectors: []
    });

    expect(result).toEqual({
      action: "skip",
      reason: "no_detectors",
      detectorCount: 0
    });
  });

  it("skips when detectors return no valid detections", () => {
    const detector: PatternDetector = {
      id: "empty",
      detect: () => null
    };

    const result = detectOpportunity({
      ...baseInput,
      detectors: [detector]
    });

    expect(result).toEqual({
      action: "skip",
      reason: "no_detection",
      detectorCount: 1
    });
  });

  it("ignores invalid detector output", () => {
    const detector: PatternDetector = {
      id: "bad-output",
      detect: () => ({
        detectorId: "bad-output",
        confidence: 2,
        question: "",
        vaultType: "momentum",
        durationSeconds: 60
      })
    };

    const result = detectOpportunity({
      ...baseInput,
      detectors: [detector]
    });

    expect(result).toEqual({
      action: "skip",
      reason: "no_detection",
      detectorCount: 1
    });
  });

  it("skips when best detection is below the confidence threshold", () => {
    const detector: PatternDetector = {
      id: "low-confidence",
      detect: () => detection({ confidence: 0.4 })
    };

    const result = detectOpportunity({
      ...baseInput,
      detectors: [detector]
    });

    expect(result.action).toBe("skip");
    if (result.action === "skip") {
      expect(result.reason).toBe("below_confidence_threshold");
      expect(result.bestDetection?.confidence).toBe(0.4);
    }
  });

  it("returns the highest-confidence detection with detector-order tie-break", () => {
    const first: PatternDetector = {
      id: "first",
      detect: () => detection({ detectorId: "first", confidence: 0.85 })
    };
    const second: PatternDetector = {
      id: "second",
      detect: () => detection({ detectorId: "second", confidence: 0.85 })
    };

    const result = detectOpportunity({
      ...baseInput,
      detectors: [first, second]
    });

    expect(result).toEqual({
      action: "detected",
      detection: detection({ detectorId: "first", confidence: 0.85 }),
      detectorId: "first"
    });
  });

  it("rejects malformed confidence thresholds", () => {
    expect(() =>
      detectOpportunity({
        ...baseInput,
        detectors: [{ id: "x", detect: () => null }],
        policy: { confidenceThreshold: 1.5 }
      })
    ).toThrow(/confidenceThreshold/);
  });

  it("rejects malformed detector definitions", () => {
    expect(() =>
      detectOpportunity({
        ...baseInput,
        detectors: [{ id: "", detect: () => null } as PatternDetector]
      })
    ).toThrow(/detectors\[0\]/);
  });

  it("detects when detector output omits detectorId and falls back to detector.id", () => {
    const detector: PatternDetector = {
      id: "fallback-detector",
      detect: () =>
        ({
          confidence: 0.9,
          question: "q",
          vaultType: "momentum",
          durationSeconds: 60
        }) as Detection
    };

    const result = detectOpportunity({
      ...baseInput,
      detectors: [detector]
    });

    expect(result).toEqual({
      action: "detected",
      detection: {
        detectorId: "fallback-detector",
        confidence: 0.9,
        question: "q",
        vaultType: "momentum",
        durationSeconds: 60
      },
      detectorId: "fallback-detector"
    });
  });

  it("detects when detector output has non-string detectorId and falls back to detector.id", () => {
    const detector: PatternDetector = {
      id: "fallback-detector",
      detect: () =>
        ({
          detectorId: 42,
          confidence: 0.9,
          question: "q",
          vaultType: "momentum",
          durationSeconds: 60
        }) as unknown as Detection
    };

    const result = detectOpportunity({
      ...baseInput,
      detectors: [detector]
    });

    expect(result).toEqual({
      action: "detected",
      detection: {
        detectorId: "fallback-detector",
        confidence: 0.9,
        question: "q",
        vaultType: "momentum",
        durationSeconds: 60
      },
      detectorId: "fallback-detector"
    });
  });

  it("skips when detector returns a primitive without crashing", () => {
    const detector: PatternDetector = {
      id: "primitive",
      detect: () => 42 as unknown as Detection
    };

    const result = detectOpportunity({
      ...baseInput,
      detectors: [detector]
    });

    expect(result).toEqual({
      action: "skip",
      reason: "no_detection",
      detectorCount: 1
    });
  });

  it("ignores a throwing detector when another detector returns a valid detection", () => {
    const throwing: PatternDetector = {
      id: "throws",
      detect: () => {
        throw new Error("detector failed");
      }
    };
    const valid: PatternDetector = {
      id: "valid",
      detect: () => detection({ detectorId: "valid", confidence: 0.9 })
    };

    const result = detectOpportunity({
      ...baseInput,
      detectors: [throwing, valid]
    });

    expect(result).toEqual({
      action: "detected",
      detection: detection({ detectorId: "valid", confidence: 0.9 }),
      detectorId: "valid"
    });
  });

  it("skips when the only detector throws", () => {
    const throwing: PatternDetector = {
      id: "throws",
      detect: () => {
        throw new Error("detector failed");
      }
    };

    const result = detectOpportunity({
      ...baseInput,
      detectors: [throwing]
    });

    expect(result).toEqual({
      action: "skip",
      reason: "no_detection",
      detectorCount: 1
    });
  });

  it("preserves detector-order tie-break when an earlier detector throws", () => {
    const throwing: PatternDetector = {
      id: "throws",
      detect: () => {
        throw new Error("detector failed");
      }
    };
    const first: PatternDetector = {
      id: "first",
      detect: () => detection({ detectorId: "first", confidence: 0.85 })
    };
    const second: PatternDetector = {
      id: "second",
      detect: () => detection({ detectorId: "second", confidence: 0.85 })
    };

    const result = detectOpportunity({
      ...baseInput,
      detectors: [throwing, first, second]
    });

    expect(result).toEqual({
      action: "detected",
      detection: detection({ detectorId: "first", confidence: 0.85 }),
      detectorId: "first"
    });
  });
});
