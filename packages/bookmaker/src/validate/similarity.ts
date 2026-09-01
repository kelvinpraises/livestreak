import type { SimilarityCandidate, SimilarityResult } from "../model/similarity.js";
import type { ValidationResult } from "./result.js";
import { validationFailure, validationSuccess } from "./result.js";

// --- exports ---

export const validateSimilarityResult = (input: unknown): ValidationResult<SimilarityResult> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("SimilarityResult must be an object");
  }

  const value = input as Record<string, unknown>;
  const issues: string[] = [];

  const marketId = requireNonEmptyString(value.marketId, "marketId", issues);

  if (!Array.isArray(value.candidates)) {
    issues.push("candidates must be an array");
  }

  const candidates: SimilarityCandidate[] = [];

  if (Array.isArray(value.candidates)) {
    for (const [index, candidate] of value.candidates.entries()) {
      const parsed = validateCandidate(candidate, `candidates[${index}]`, marketId, issues);
      if (parsed !== undefined) {
        candidates.push(parsed);
      }
    }
  }

  requireOptionalDuplicateRisk(value.duplicateRisk, issues);
  requireOptionalStringArray(value.stewardWarnings, "stewardWarnings", issues);

  if (issues.length > 0) {
    return validationFailure(...issues);
  }

  return validationSuccess({
    marketId: marketId!,
    candidates,
    ...(optionalDuplicateRisk(value.duplicateRisk) === undefined
      ? {}
      : { duplicateRisk: optionalDuplicateRisk(value.duplicateRisk) }),
    ...(optionalStringArray(value.stewardWarnings) === undefined
      ? {}
      : { stewardWarnings: optionalStringArray(value.stewardWarnings) })
  });
};

// --- helpers ---

const validateCandidate = (
  input: unknown,
  fieldPath: string,
  expectedMarketId: string | undefined,
  issues: string[]
): SimilarityCandidate | undefined => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    issues.push(`${fieldPath} must be an object`);
    return undefined;
  }

  const value = input as Record<string, unknown>;

  if (value.kind !== "vault") {
    issues.push(`${fieldPath}.kind must be "vault"`);
  }

  const vaultId = requireNonEmptyString(value.vaultId, `${fieldPath}.vaultId`, issues);
  const candidateMarketId = requireNonEmptyString(value.marketId, `${fieldPath}.marketId`, issues);
  const reason = requireNonEmptyString(value.reason, `${fieldPath}.reason`, issues);

  if (
    expectedMarketId !== undefined &&
    candidateMarketId !== undefined &&
    candidateMarketId !== expectedMarketId
  ) {
    issues.push(`${fieldPath}.marketId must match SimilarityResult.marketId`);
  }

  if (typeof value.score !== "number" || Number.isFinite(value.score) === false) {
    issues.push(`${fieldPath}.score must be a finite number`);
  } else if (value.score < 0 || value.score > 1) {
    issues.push(`${fieldPath}.score must be between 0 and 1`);
  }

  if (
    value.suggestedAction !== "join-existing" &&
    value.suggestedAction !== "create-new" &&
    value.suggestedAction !== "skip"
  ) {
    issues.push(`${fieldPath}.suggestedAction must be join-existing, create-new, or skip`);
  }

  if (
    vaultId === undefined ||
    candidateMarketId === undefined ||
    reason === undefined ||
    typeof value.score !== "number" ||
    (value.suggestedAction !== "join-existing" &&
      value.suggestedAction !== "create-new" &&
      value.suggestedAction !== "skip")
  ) {
    return undefined;
  }

  return {
    kind: "vault",
    vaultId,
    marketId: candidateMarketId,
    score: value.score,
    reason,
    suggestedAction: value.suggestedAction
  };
};

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

const requireOptionalDuplicateRisk = (value: unknown, issues: string[]): void => {
  if (value === undefined) {
    return;
  }

  if (value !== "low" && value !== "medium" && value !== "high") {
    issues.push('duplicateRisk must be "low", "medium", or "high" when provided');
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

const optionalDuplicateRisk = (
  value: unknown
): "low" | "medium" | "high" | undefined =>
  value === "low" || value === "medium" || value === "high" ? value : undefined;

const optionalStringArray = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());

  return entries.length > 0 ? entries : undefined;
};
