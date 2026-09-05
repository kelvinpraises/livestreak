import type { Detection } from "../../model/detection.js";
import type { PatternDetector } from "./types.js";

// --- exports ---

export interface EventKindDetectorConfig {
  readonly id: string;
  readonly kind: string;
  readonly question: string;
  readonly vaultType: string;
  readonly durationSeconds: number;
  readonly confidence: number;
  readonly suggestedSide?: "yes" | "no";
  readonly suggestedStake?: bigint;
}

export interface PayloadThresholdDetectorConfig {
  readonly id: string;
  readonly field: string;
  readonly threshold: number;
  readonly operator: "gte" | "lte";
  readonly question: string;
  readonly vaultType: string;
  readonly durationSeconds: number;
  readonly confidence: number;
}

export const createEventKindDetector = (config: EventKindDetectorConfig): PatternDetector => ({
  id: config.id,
  detect: (input) => {
    const event = input.events.find((entry) => entry.kind === config.kind);
    if (event === undefined) {
      return null;
    }

    return buildDetection(config, event.observationId);
  }
});

export const createPayloadThresholdDetector = (config: PayloadThresholdDetectorConfig): PatternDetector => ({
  id: config.id,
  detect: (input) => {
    for (const event of input.events) {
      const value = readNumericPayloadField(event.payload, config.field);
      if (value === undefined) {
        continue;
      }

      const matches =
        config.operator === "gte" ? value >= config.threshold : value <= config.threshold;

      if (matches) {
        return buildDetection(config, event.observationId);
      }
    }

    return null;
  }
});

// --- helpers ---

const buildDetection = (
  config: EventKindDetectorConfig | PayloadThresholdDetectorConfig,
  observationRef: string
): Detection => ({
  detectorId: config.id,
  confidence: config.confidence,
  question: config.question,
  vaultType: config.vaultType,
  durationSeconds: config.durationSeconds,
  observationRef,
  ...("suggestedSide" in config && config.suggestedSide !== undefined
    ? { suggestedSide: config.suggestedSide }
    : {}),
  ...("suggestedStake" in config && config.suggestedStake !== undefined
    ? { suggestedStake: config.suggestedStake }
    : {})
});

const readNumericPayloadField = (
  payload: Readonly<Record<string, unknown>> | undefined,
  field: string
): number | undefined => {
  if (payload === undefined) {
    return undefined;
  }

  const value = payload[field];
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return undefined;
  }

  return value;
};
