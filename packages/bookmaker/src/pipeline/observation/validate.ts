import type { ObservationEvent } from "./feed.js";
import type { ValidationResult } from "../../model/validate.js";
import { validationFailure, validationSuccess } from "../../model/validate.js";

// --- exports ---

export const validateObservationEvent = (
  input: unknown,
  expectedMarketId?: string
): ValidationResult<ObservationEvent> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("ObservationEvent must be an object");
  }

  const value = input as Record<string, unknown>;
  const issues: string[] = [];

  const marketId = requireNonEmptyString(value.marketId, "marketId", issues);
  const observationId = requireNonEmptyString(value.observationId, "observationId", issues);

  if (typeof value.observedAtMs !== "number" || Number.isFinite(value.observedAtMs) === false) {
    issues.push("observedAtMs must be a finite number");
  }

  if (expectedMarketId !== undefined && marketId !== undefined && marketId !== expectedMarketId) {
    issues.push("marketId must match the expected observation feed marketId");
  }

  requireOptionalNonEmptyString(value.kind, "kind", issues);

  if (
    value.payload !== undefined &&
    (typeof value.payload !== "object" || value.payload === null || Array.isArray(value.payload))
  ) {
    // B11: arrays are typeof "object" but `plainObject` rejects them, so without
    // this guard an array payload passed validation yet was silently dropped.
    issues.push("payload must be a plain object when provided");
  }

  if (
    issues.length > 0 ||
    marketId === undefined ||
    observationId === undefined ||
    typeof value.observedAtMs !== "number"
  ) {
    return validationFailure(...issues);
  }

  return validationSuccess({
    marketId,
    observationId,
    observedAtMs: value.observedAtMs,
    ...(optionalString(value.kind) === undefined ? {} : { kind: optionalString(value.kind) }),
    ...(plainObject(value.payload) === undefined ? {} : { payload: plainObject(value.payload) })
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

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const plainObject = (value: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Readonly<Record<string, unknown>>;
};
