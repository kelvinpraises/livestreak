import type { BookmakerDecision, BookmakerSkipReason } from "../model/decision.js";
import type { ValidationResult } from "./result.js";
import { validateDetection } from "./detection.js";
import { validationFailure, validationSuccess } from "./result.js";
import { validateVaultDraft } from "./vault-draft.js";

// --- exports ---

export const validateBookmakerDecision = (input: unknown): ValidationResult<BookmakerDecision> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return validationFailure("BookmakerDecision must be an object");
  }

  const value = input as Record<string, unknown>;

  if (value.action === "createVault") {
    return validateCreateVaultDecision(value);
  }

  if (value.action === "joinVault") {
    return validateJoinVaultDecision(value);
  }

  if (value.action === "skip") {
    return validateSkipDecision(value);
  }

  return validationFailure('action must be "createVault", "joinVault", or "skip"');
};

// --- helpers ---

const validateCreateVaultDecision = (
  value: Record<string, unknown>
): ValidationResult<BookmakerDecision> => {
  const draft = validateVaultDraft(value.draft);
  if (draft.ok === false) {
    return validationFailure(...draft.issues.map((issue) => `draft.${issue}`));
  }

  const detection = validateDetection(value.detection);
  if (detection.ok === false) {
    return validationFailure(...detection.issues.map((issue) => `detection.${issue}`));
  }

  return validationSuccess({
    action: "createVault",
    draft: draft.value,
    detection: detection.value
  });
};

const validateJoinVaultDecision = (
  value: Record<string, unknown>
): ValidationResult<BookmakerDecision> => {
  if (typeof value.vaultId !== "string" || value.vaultId.trim().length === 0) {
    return validationFailure("vaultId must be a non-empty string");
  }

  const draft = validateVaultDraft(value.draft);
  if (draft.ok === false) {
    return validationFailure(...draft.issues.map((issue) => `draft.${issue}`));
  }

  const detection = validateDetection(value.detection);
  if (detection.ok === false) {
    return validationFailure(...detection.issues.map((issue) => `detection.${issue}`));
  }

  return validationSuccess({
    action: "joinVault",
    vaultId: value.vaultId.trim(),
    draft: draft.value,
    detection: detection.value
  });
};

const validateSkipDecision = (value: Record<string, unknown>): ValidationResult<BookmakerDecision> => {
  const allowedReasons = [
    "no_detectors",
    "no_detection",
    "below_confidence_threshold",
    "duplicate_vault",
    "steward_warning",
    "invalid_draft",
    "market_not_found",
    "market_inactive"
  ] as const;

  if (typeof value.reason !== "string" || !allowedReasons.includes(value.reason as (typeof allowedReasons)[number])) {
    return validationFailure("reason must be a known BookmakerSkipReason");
  }

  if (value.detection === undefined) {
    return validationSuccess({
      action: "skip",
      reason: value.reason as BookmakerSkipReason
    });
  }

  const detection = validateDetection(value.detection);
  if (detection.ok === false) {
    return validationFailure(...detection.issues.map((issue) => `detection.${issue}`));
  }

  return validationSuccess({
    action: "skip",
    reason: value.reason as BookmakerSkipReason,
    detection: detection.value
  });
};
