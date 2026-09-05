import type { BookmakerMarketContext } from "../../model/market-context.js";
import type { Detection } from "../../model/detection.js";
import type { BookmakerWatchSource } from "../../model/watch-source.js";
import type { ObservationEvent } from "../observation/feed.js";

// --- exports ---

export interface PatternDetectionInput {
  readonly marketContext: BookmakerMarketContext;
  readonly watchSource?: BookmakerWatchSource;
  readonly events: readonly ObservationEvent[];
  readonly nowMs: number;
}

export interface PatternDetector {
  readonly id: string;
  readonly detect: (input: PatternDetectionInput) => Detection | null;
}

export interface BookmakerDetectionPolicy {
  readonly confidenceThreshold: number;
}

export interface BookmakerDetectionInput {
  readonly marketContext: BookmakerMarketContext;
  readonly watchSource?: BookmakerWatchSource;
  readonly events: readonly ObservationEvent[];
  readonly detectors: readonly PatternDetector[];
  readonly policy: BookmakerDetectionPolicy;
  readonly nowMs: number;
}

export type BookmakerDetectionEvaluation =
  | {
      readonly action: "detected";
      readonly detection: Detection;
      readonly detectorId: string;
    }
  | {
      readonly action: "skip";
      readonly reason: "no_detectors" | "no_detection" | "below_confidence_threshold";
      readonly detectorCount: number;
      readonly bestDetection?: Detection;
    };
