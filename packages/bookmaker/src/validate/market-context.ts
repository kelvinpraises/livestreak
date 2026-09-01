import type { BookmakerMarketContext } from "../model/market-context.js";
import type { ValidationResult } from "./result.js";
import { validationFailure, validationSuccess } from "./result.js";

// --- exports ---

export const validateBookmakerMarketContext = (
  input: unknown
): ValidationResult<BookmakerMarketContext> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("BookmakerMarketContext must be an object");
  }

  const value = input as Record<string, unknown>;
  const issues: string[] = [];

  const marketId = requireNonEmptyString(value.marketId, "marketId", issues);
  const observeRunId = requireNonEmptyString(value.observeRunId, "observeRunId", issues);
  const observer = requireNonEmptyString(value.observer, "observer", issues);

  requireOptionalNonEmptyString(value.endpointManifestUri, "endpointManifestUri", issues);
  requireOptionalNonEmptyString(value.subjectRef, "subjectRef", issues);
  requireOptionalNonEmptyString(value.category, "category", issues);
  requireOptionalNonEmptyString(value.title, "title", issues);
  requireOptionalNonEmptyString(value.rulesetId, "rulesetId", issues);
  requireOptionalFiniteNumber(value.startedAtMs, "startedAtMs", issues);
  requireOptionalStringArray(value.evidenceRefs, "evidenceRefs", issues);

  if (issues.length > 0) {
    return validationFailure(...issues);
  }

  return validationSuccess({
    marketId: marketId!,
    observeRunId: observeRunId!,
    observer: observer!,
    ...(optionalString(value.endpointManifestUri) === undefined
      ? {}
      : { endpointManifestUri: optionalString(value.endpointManifestUri) }),
    ...(optionalString(value.subjectRef) === undefined
      ? {}
      : { subjectRef: optionalString(value.subjectRef) }),
    ...(optionalString(value.category) === undefined ? {} : { category: optionalString(value.category) }),
    ...(optionalString(value.title) === undefined ? {} : { title: optionalString(value.title) }),
    ...(optionalString(value.rulesetId) === undefined
      ? {}
      : { rulesetId: optionalString(value.rulesetId) }),
    ...(optionalFiniteNumber(value.startedAtMs) === undefined
      ? {}
      : { startedAtMs: optionalFiniteNumber(value.startedAtMs) }),
    ...(optionalStringArray(value.evidenceRefs) === undefined
      ? {}
      : { evidenceRefs: optionalStringArray(value.evidenceRefs) })
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

const requireOptionalFiniteNumber = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): void => {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || Number.isFinite(value) === false) {
    issues.push(`${fieldPath} must be a finite number when provided`);
  }
};

const requireOptionalStringArray = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): void => {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    issues.push(`${fieldPath} must be an array of strings when provided`);
    return;
  }

  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      issues.push(`${fieldPath}[${index}] must be a non-empty string`);
    }
  }
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const optionalFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const optionalStringArray = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());

  return entries.length > 0 ? entries : undefined;
};
