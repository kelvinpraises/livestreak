import type { VaultDraft, VaultResolutionWindow } from "../model/vault-draft.js";
import type { ValidationResult } from "./result.js";
import { validationFailure, validationSuccess } from "./result.js";

// --- exports ---

export const validateVaultDraft = (input: unknown): ValidationResult<VaultDraft> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("VaultDraft must be an object");
  }

  const value = input as Record<string, unknown>;
  const issues: string[] = [];

  const marketId = requireNonEmptyString(value.marketId, "marketId", issues);
  const question = requireNonEmptyString(value.question, "question", issues);
  const resolutionSource = requireNonEmptyString(value.resolutionSource, "resolutionSource", issues);
  const fundingToken = requireNonEmptyString(value.fundingToken, "fundingToken", issues);

  if (value.outcomeKind !== "binary") {
    issues.push('outcomeKind must be "binary"');
  }

  if (!isBinarySides(value.sides)) {
    issues.push('sides must be ["yes", "no"]');
  }

  const resolutionWindow = validateResolutionWindow(value.resolutionWindow, issues);

  requireOptionalNonEmptyString(value.vaultType, "vaultType", issues);
  requireOptionalSide(value.creatorSide, "creatorSide", issues);
  requireOptionalNonNegativeBigInt(value.creatorStake, "creatorStake", issues);
  requireOptionalStringArray(value.evidenceRefs, "evidenceRefs", issues);
  requireOptionalNonEmptyString(value.observationRef, "observationRef", issues);

  if (issues.length > 0) {
    return validationFailure(...issues);
  }

  return validationSuccess({
    marketId: marketId!,
    question: question!,
    outcomeKind: "binary",
    sides: ["yes", "no"],
    resolutionSource: resolutionSource!,
    resolutionWindow: resolutionWindow!,
    fundingToken: fundingToken!,
    ...(optionalString(value.vaultType) === undefined ? {} : { vaultType: optionalString(value.vaultType) }),
    ...(optionalSide(value.creatorSide) === undefined ? {} : { creatorSide: optionalSide(value.creatorSide) }),
    ...(optionalNonNegativeBigInt(value.creatorStake) === undefined
      ? {}
      : { creatorStake: optionalNonNegativeBigInt(value.creatorStake) }),
    ...(optionalStringArray(value.evidenceRefs) === undefined
      ? {}
      : { evidenceRefs: optionalStringArray(value.evidenceRefs) }),
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

const requireOptionalNonNegativeBigInt = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): void => {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "bigint" || value < 0n) {
    issues.push(`${fieldPath} must be a non-negative bigint when provided`);
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

const validateResolutionWindow = (
  value: unknown,
  issues: string[]
): VaultResolutionWindow | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push("resolutionWindow must be an object");
    return undefined;
  }

  const window = value as Record<string, unknown>;

  if (window.expiresAtMs === undefined) {
    issues.push("resolutionWindow.expiresAtMs is required");
    return undefined;
  }

  if (typeof window.expiresAtMs !== "number" || Number.isFinite(window.expiresAtMs) === false) {
    issues.push("resolutionWindow.expiresAtMs must be a finite number");
    return undefined;
  }

  if (window.opensAtMs !== undefined) {
    if (typeof window.opensAtMs !== "number" || Number.isFinite(window.opensAtMs) === false) {
      issues.push("resolutionWindow.opensAtMs must be a finite number when provided");
      return undefined;
    }

    if (window.opensAtMs >= window.expiresAtMs) {
      issues.push("resolutionWindow.opensAtMs must be before expiresAtMs");
      return undefined;
    }
  }

  return {
    expiresAtMs: window.expiresAtMs,
    ...(window.opensAtMs === undefined ? {} : { opensAtMs: window.opensAtMs })
  };
};

const isBinarySides = (value: unknown): value is readonly ["yes", "no"] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value[0] === "yes" &&
  value[1] === "no";

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const optionalSide = (value: unknown): "yes" | "no" | undefined =>
  value === "yes" || value === "no" ? value : undefined;

const optionalNonNegativeBigInt = (value: unknown): bigint | undefined =>
  typeof value === "bigint" && value >= 0n ? value : undefined;

const optionalStringArray = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());

  return entries.length > 0 ? entries : undefined;
};
