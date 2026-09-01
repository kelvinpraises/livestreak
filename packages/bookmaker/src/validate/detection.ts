import type { Detection } from "../model/detection.js";
import type { ValidationResult } from "./result.js";
import { validationFailure, validationSuccess } from "./result.js";

// --- exports ---

export const validateDetection = (input: unknown): ValidationResult<Detection> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("Detection must be an object");
  }

  const value = input as Record<string, unknown>;
  const issues: string[] = [];

  const detectorId = requireNonEmptyString(value.detectorId, "detectorId", issues);
  const question = requireNonEmptyString(value.question, "question", issues);
  const vaultType = requireNonEmptyString(value.vaultType, "vaultType", issues);

  if (typeof value.confidence !== "number" || Number.isFinite(value.confidence) === false) {
    issues.push("confidence must be a finite number");
  } else if (value.confidence < 0 || value.confidence > 1) {
    issues.push("confidence must be between 0 and 1");
  }

  if (
    typeof value.durationSeconds !== "number" ||
    Number.isFinite(value.durationSeconds) === false ||
    value.durationSeconds <= 0
  ) {
    issues.push("durationSeconds must be a positive finite number");
  }

  requireOptionalSide(value.suggestedSide, "suggestedSide", issues);
  requireOptionalPositiveBigInt(value.suggestedStake, "suggestedStake", issues);
  requireOptionalNonEmptyString(value.observationRef, "observationRef", issues);

  if (issues.length > 0) {
    return validationFailure(...issues);
  }

  return validationSuccess({
    detectorId: detectorId!,
    confidence: value.confidence as number,
    question: question!,
    vaultType: vaultType!,
    durationSeconds: value.durationSeconds as number,
    ...(optionalSide(value.suggestedSide) === undefined
      ? {}
      : { suggestedSide: optionalSide(value.suggestedSide) }),
    ...(optionalPositiveBigInt(value.suggestedStake) === undefined
      ? {}
      : { suggestedStake: optionalPositiveBigInt(value.suggestedStake) }),
    ...(optionalString(value.observationRef) === undefined
      ? {}
      : { observationRef: optionalString(value.observationRef) })
  });
};

// --- helpers ---

const requireNonEmptyString = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): string | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${fieldPath} must be a non-empty string`);
    return undefined;
  }

  return value.trim();
};

const requireOptionalNonEmptyString = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): void => {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${fieldPath} must be a non-empty string when provided`);
  }
};

const requireOptionalSide = (value: unknown, fieldPath: string, issues: string[]): void => {
  if (value === undefined) {
    return;
  }

  if (value !== "yes" && value !== "no") {
    issues.push(`${fieldPath} must be "yes" or "no" when provided`);
  }
};

const requireOptionalPositiveBigInt = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): void => {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "bigint" || value <= 0n) {
    issues.push(`${fieldPath} must be a positive bigint when provided`);
  }
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const optionalSide = (value: unknown): "yes" | "no" | undefined =>
  value === "yes" || value === "no" ? value : undefined;

const optionalPositiveBigInt = (value: unknown): bigint | undefined =>
  typeof value === "bigint" && value > 0n ? value : undefined;
