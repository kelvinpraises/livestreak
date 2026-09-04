import type { BookmakerWriteIntent, CreateVaultIntent } from "../model/write-intent.js";
import type { ValidationResult } from "./result.js";
import { validationFailure, validationSuccess } from "./result.js";

// --- exports ---

export const validateCreateVaultIntent = (
  input: unknown,
  nowMs: number
): ValidationResult<CreateVaultIntent> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("CreateVaultIntent must be an object");
  }

  const value = input as Record<string, unknown>;
  const issues: string[] = [];

  if (value.action !== "createVault") {
    issues.push('action must be "createVault"');
  }

  const marketId = requireNonEmptyString(value.marketId, "marketId", issues);
  const question = requireNonEmptyString(value.question, "question", issues);
  const creatorSide = requireSide(value.creatorSide, "creatorSide", issues);
  const creatorStake = requirePositiveBigInt(value.creatorStake, "creatorStake", issues);
  const seedRate = requirePositiveBigInt(value.seedRate, "seedRate", issues);

  const resolutionSource = requireNonEmptyString(value.resolutionSource, "resolutionSource", issues);
  const resolutionWindowExpiresAtMs = requirePositiveNumber(
    value.resolutionWindowExpiresAtMs,
    "resolutionWindowExpiresAtMs",
    issues
  );

  if (typeof nowMs !== "number" || Number.isFinite(nowMs) === false) {
    issues.push("nowMs must be a finite number");
  }

  if (issues.length > 0) {
    return validationFailure(...issues);
  }

  return validationSuccess({
    action: "createVault",
    marketId: marketId!,
    question: question!,
    creatorSide: creatorSide!,
    creatorStake: creatorStake!,
    seedRate: seedRate!,
    resolutionSource: resolutionSource!,
    resolutionWindowExpiresAtMs: resolutionWindowExpiresAtMs!
  });
};

export const validateBookmakerWriteIntent = (
  input: unknown,
  nowMs: number
): ValidationResult<BookmakerWriteIntent> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("BookmakerWriteIntent must be an object");
  }

  const value = input as Record<string, unknown>;

  if (value.action === "createVault") {
    return validateCreateVaultIntent(input, nowMs);
  }

  if (value.action === "joinExistingVault") {
    const issues: string[] = [];
    const marketId = requireNonEmptyString(value.marketId, "marketId", issues);
    const vaultId = requireNonEmptyString(value.vaultId, "vaultId", issues);

    if (issues.length > 0) {
      return validationFailure(...issues);
    }

    return validationSuccess({
      action: "joinExistingVault",
      marketId: marketId!,
      vaultId: vaultId!
    });
  }

  return validationFailure('action must be "createVault" or "joinExistingVault"');
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

const requireSide = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): "yes" | "no" | undefined => {
  if (value !== "yes" && value !== "no") {
    issues.push(`${fieldPath} must be "yes" or "no"`);
    return undefined;
  }

  return value;
};

const requirePositiveBigInt = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): bigint | undefined => {
  if (typeof value !== "bigint" || value <= 0n) {
    issues.push(`${fieldPath} must be a bigint > 0`);
    return undefined;
  }

  return value;
};

const requirePositiveNumber = (
  value: unknown,
  fieldPath: string,
  issues: string[]
): number | undefined => {
  if (typeof value !== "number" || Number.isFinite(value) === false || value <= 0) {
    issues.push(`${fieldPath} must be a finite number > 0`);
    return undefined;
  }

  return value;
};
