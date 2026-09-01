import { LiveStreakConfigError } from "@livestreak/core";

import { isTeeAttestationRef } from "../facts/tee.js";
import type {
  StewardFinding,
  StewardFindingKind,
  StewardFindingSeverity
} from "../model/finding.js";
import { isStewardSubject, validateStewardSubject } from "./subject.js";

// --- exports ---

export const STEWARD_FINDING_KINDS = [
  "duplicate_vault",
  "bad_evidence",
  "missing_evidence",
  "bad_resolution",
  "rogue_observer",
  "rogue_bookmaker",
  "rogue_steward",
  "market_hot",
  "manual_note"
] as const satisfies readonly StewardFindingKind[];

export const STEWARD_FINDING_SEVERITIES = ["info", "warning", "critical"] as const satisfies readonly StewardFindingSeverity[];

export const isStewardFindingKind = (value: unknown): value is StewardFindingKind =>
  typeof value === "string" && (STEWARD_FINDING_KINDS as readonly string[]).includes(value);

export const isStewardFindingSeverity = (value: unknown): value is StewardFindingSeverity =>
  typeof value === "string" &&
  (STEWARD_FINDING_SEVERITIES as readonly string[]).includes(value);

export const isStewardFinding = (value: unknown): value is StewardFinding => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.id !== "string" || record.id.trim().length === 0) {
    return false;
  }

  if (!isStewardFindingKind(record.kind)) {
    return false;
  }

  if (!isStewardSubject(record.subject)) {
    return false;
  }

  if (!isStewardFindingSeverity(record.severity)) {
    return false;
  }

  if (typeof record.message !== "string" || record.message.trim().length === 0) {
    return false;
  }

  if (record.evidenceRefs !== undefined) {
    if (!Array.isArray(record.evidenceRefs)) {
      return false;
    }

    if (record.evidenceRefs.length === 0) {
      return false;
    }

    if (record.evidenceRefs.some((ref) => !isNonEmptyString(ref))) {
      return false;
    }
  }

  if (record.attestationRef !== undefined && !isTeeAttestationRef(record.attestationRef)) {
    return false;
  }

  if (record.createdAtMs !== undefined && !isFiniteNumber(record.createdAtMs)) {
    return false;
  }

  return true;
};

export const validateStewardFinding = (value: unknown): StewardFinding => {
  if (!isStewardFinding(value)) {
    throw new LiveStreakConfigError({
      message: "Invalid steward finding",
      metadata: { details: "Finding requires id, kind, subject, severity, and message" }
    });
  }

  return {
    ...value,
    subject: validateStewardSubject(value.subject)
  };
};

// --- helpers ---

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
