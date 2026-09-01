import { LiveStreakConfigError } from "@livestreak/core";

import type { StewardSubject, StewardSubjectKind } from "../model/subject.js";

// --- exports ---

export const STEWARD_SUBJECT_KINDS = [
  "market",
  "vault",
  "observer",
  "bookmaker",
  "steward",
  "evidence",
  "resolution"
] as const satisfies readonly StewardSubjectKind[];

export const isStewardSubjectKind = (value: unknown): value is StewardSubjectKind =>
  typeof value === "string" && (STEWARD_SUBJECT_KINDS as readonly string[]).includes(value);

export const validateStewardSubjectKind = (value: unknown): StewardSubjectKind => {
  if (isStewardSubjectKind(value)) {
    return value;
  }

  throw new LiveStreakConfigError({
    message: "Invalid steward subject kind",
    metadata: {
      details: `Expected one of ${STEWARD_SUBJECT_KINDS.join(", ")}, received ${String(value)}`
    }
  });
};

export const isStewardSubject = (value: unknown): value is StewardSubject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (!isStewardSubjectKind(record.kind)) {
    return false;
  }

  if (typeof record.id !== "string" || record.id.trim().length === 0) {
    return false;
  }

  if (record.marketId !== undefined && typeof record.marketId !== "string") {
    return false;
  }

  if (record.vaultId !== undefined && typeof record.vaultId !== "string") {
    return false;
  }

  return true;
};

export const validateStewardSubject = (value: unknown): StewardSubject => {
  if (!isStewardSubject(value)) {
    throw new LiveStreakConfigError({
      message: "Invalid steward subject",
      metadata: { details: "Subject requires kind and non-empty id" }
    });
  }

  return value;
};
