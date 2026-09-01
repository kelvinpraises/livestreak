import { LiveStreakConfigError } from "@livestreak/core";

import type { StewardDecision, StewardDecisionAction } from "../model/decision.js";
import { isStewardFinding, validateStewardFinding } from "./finding.js";

// --- exports ---

export const STEWARD_DECISION_ACTIONS = [
  "ignore",
  "annotate",
  "openThread",
  "triggerHot",
  "challenge",
  "resolve",
  "proposePenalty",
  "vetoSteward",
  "challengeStewardDecision"
] as const satisfies readonly StewardDecisionAction[];

export const STEWARD_OF_STEWARDS_ACTIONS = [
  "proposePenalty",
  "vetoSteward",
  "challengeStewardDecision"
] as const satisfies readonly StewardDecisionAction[];

export const isStewardDecisionAction = (value: unknown): value is StewardDecisionAction =>
  typeof value === "string" && (STEWARD_DECISION_ACTIONS as readonly string[]).includes(value);

export const isStewardDecision = (value: unknown): value is StewardDecision => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (!isStewardDecisionAction(record.action)) {
    return false;
  }

  if (!isStewardFinding(record.finding)) {
    return false;
  }

  if (typeof record.reason !== "string" || record.reason.trim().length === 0) {
    return false;
  }

  if (record.decidedAtMs !== undefined && typeof record.decidedAtMs !== "number") {
    return false;
  }

  return true;
};

export const validateStewardDecision = (value: unknown): StewardDecision => {
  if (!isStewardDecision(value)) {
    throw new LiveStreakConfigError({
      message: "Invalid steward decision",
      metadata: { details: "Decision requires action, finding, and reason" }
    });
  }

  return {
    ...value,
    finding: validateStewardFinding(value.finding)
  };
};
