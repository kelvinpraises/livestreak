import type { Detection } from "../../model/detection.js";
import { LiveStreakConfigError } from "@livestreak/core";
import { validateDetection } from "../../model/validate.js";
import type {
  BookmakerDetectionEvaluation,
  BookmakerDetectionInput,
  DetectorFailure,
  PatternDetectionInput,
  PatternDetector
} from "./types.js";

// --- exports ---

export const detectOpportunity = (input: BookmakerDetectionInput): BookmakerDetectionEvaluation => {
  const confidenceThreshold = validateConfidenceThreshold(input.policy.confidenceThreshold);
  const detectors = validateDetectors(input.detectors);

  if (detectors.length === 0) {
    return {
      action: "skip",
      reason: "no_detectors",
      detectorCount: 0
    };
  }

  const patternInput: PatternDetectionInput = {
    marketContext: input.marketContext,
    ...(input.watchSource === undefined ? {} : { watchSource: input.watchSource }),
    events: input.events,
    nowMs: input.nowMs
  };

  const { detections, failures } = collectValidDetections(detectors, patternInput);
  const withFailures = failures.length > 0 ? { detectorFailures: failures } : {};

  if (detections.length === 0) {
    return {
      action: "skip",
      reason: "no_detection",
      detectorCount: detectors.length,
      ...withFailures
    };
  }

  const best = selectBestDetection(detections);

  if (best.detection.confidence < confidenceThreshold) {
    return {
      action: "skip",
      reason: "below_confidence_threshold",
      detectorCount: detectors.length,
      bestDetection: best.detection,
      ...withFailures
    };
  }

  return {
    action: "detected",
    detection: best.detection,
    detectorId: best.detectorId,
    ...withFailures
  };
};

// --- helpers ---

const validateConfidenceThreshold = (confidenceThreshold: number): number => {
  if (
    typeof confidenceThreshold !== "number" ||
    Number.isFinite(confidenceThreshold) === false ||
    confidenceThreshold < 0 ||
    confidenceThreshold > 1
  ) {
    throw new LiveStreakConfigError({
      message: "confidenceThreshold must be a finite number between 0 and 1"
    });
  }

  return confidenceThreshold;
};

const validateDetectors = (detectors: readonly PatternDetector[]): readonly PatternDetector[] => {
  if (!Array.isArray(detectors)) {
    throw new LiveStreakConfigError({
      message: "detectors must be an array"
    });
  }

  for (const [index, detector] of detectors.entries()) {
    if (isPatternDetector(detector) === false) {
      throw new LiveStreakConfigError({
        message: `detectors[${index}] must include a non-empty id and detect function`
      });
    }
  }

  return detectors;
};

const isPatternDetector = (detector: unknown): detector is PatternDetector =>
  typeof detector === "object" &&
  detector !== null &&
  typeof (detector as PatternDetector).id === "string" &&
  (detector as PatternDetector).id.trim().length > 0 &&
  typeof (detector as PatternDetector).detect === "function";

const collectValidDetections = (
  detectors: readonly PatternDetector[],
  input: PatternDetectionInput
): {
  readonly detections: readonly { readonly detection: Detection; readonly detectorId: string }[];
  readonly failures: readonly DetectorFailure[];
} => {
  const detections: { detection: Detection; detectorId: string }[] = [];
  const failures: DetectorFailure[] = [];

  for (const detector of detectors) {
    let raw: Detection | null;

    try {
      raw = detector.detect(input);
    } catch (error) {
      // A broken detector must be visible, not silently indistinguishable from "no detection".
      // Record its failure and keep evaluating the other detectors.
      failures.push({
        detectorId: detector.id,
        message: error instanceof Error ? error.message : String(error)
      });
      continue;
    }

    if (raw === null) {
      continue;
    }

    // B9: the registry `detector.id` is the single source of truth for
    // attribution — a detector mislabeling itself must not win. Stamp it on both
    // the stored detection and the returned tuple.
    const validated = validateDetection({
      ...(typeof raw === "object" && raw !== null ? raw : {}),
      detectorId: detector.id
    });

    if (validated.ok) {
      detections.push({
        detection: validated.value,
        detectorId: detector.id
      });
    }
  }

  return { detections, failures };
};

const selectBestDetection = (
  detections: readonly { readonly detection: Detection; readonly detectorId: string }[]
): { readonly detection: Detection; readonly detectorId: string } => {
  let best = detections[0]!;

  for (const candidate of detections.slice(1)) {
    if (candidate.detection.confidence > best.detection.confidence) {
      best = candidate;
    }
  }

  return best;
};
