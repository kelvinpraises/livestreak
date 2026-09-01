import type { BookmakerWatchSource } from "../model/watch-source.js";
import type { ValidationResult } from "./result.js";
import { validationFailure, validationSuccess } from "./result.js";

// --- exports ---

export const validateBookmakerWatchSource = (input: unknown): ValidationResult<BookmakerWatchSource> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("BookmakerWatchSource must be an object");
  }

  const value = input as Record<string, unknown>;
  const issues: string[] = [];

  const marketId = requireNonEmptyString(value.marketId, "marketId", issues);

  requireOptionalNonEmptyString(value.watchUrl, "watchUrl", issues);
  requireOptionalNonEmptyString(value.webrtcUrl, "webrtcUrl", issues);
  requireOptionalNonEmptyString(value.observationEndpoint, "observationEndpoint", issues);
  requireOptionalNonEmptyString(value.endpointManifestUri, "endpointManifestUri", issues);
  requireOptionalStringArray(value.cacheReceiptRefs, "cacheReceiptRefs", issues);

  if (issues.length > 0) {
    return validationFailure(...issues);
  }

  return validationSuccess({
    marketId: marketId!,
    ...(optionalString(value.watchUrl) === undefined ? {} : { watchUrl: optionalString(value.watchUrl) }),
    ...(optionalString(value.webrtcUrl) === undefined ? {} : { webrtcUrl: optionalString(value.webrtcUrl) }),
    ...(optionalString(value.observationEndpoint) === undefined
      ? {}
      : { observationEndpoint: optionalString(value.observationEndpoint) }),
    ...(optionalString(value.endpointManifestUri) === undefined
      ? {}
      : { endpointManifestUri: optionalString(value.endpointManifestUri) }),
    ...(optionalStringArray(value.cacheReceiptRefs) === undefined
      ? {}
      : { cacheReceiptRefs: optionalStringArray(value.cacheReceiptRefs) })
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

const optionalStringArray = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());

  return entries.length > 0 ? entries : undefined;
};
