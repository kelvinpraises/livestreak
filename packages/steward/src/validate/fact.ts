import { LiveStreakConfigError } from "@livestreak/core";

import { STEWARD_FACT_SOURCES } from "../workflow/facts/fact.js";
import type { StewardFact, StewardFactSource } from "../workflow/facts/fact.js";
import { isTeeAttestationRef } from "../workflow/facts/tee.js";
import { isStewardSubject, validateStewardSubject } from "./subject.js";

// --- exports ---

export const isStewardFactSource = (value: unknown): value is StewardFactSource =>
  typeof value === "string" && (STEWARD_FACT_SOURCES as readonly string[]).includes(value);

export const isStewardFact = (value: unknown): value is StewardFact => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (!isNonEmptyString(record.id)) {
    return false;
  }

  if (!isStewardSubject(record.subject)) {
    return false;
  }

  if (!isStewardFactSource(record.source)) {
    return false;
  }

  if (!isNonEmptyString(record.key)) {
    return false;
  }

  if (!("value" in record)) {
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

  if (record.observedAtMs !== undefined && !isFiniteNumber(record.observedAtMs)) {
    return false;
  }

  return true;
};

export const validateStewardFact = (value: unknown): StewardFact => {
  if (!isStewardFact(value)) {
    throw new LiveStreakConfigError({
      message: "Invalid steward fact",
      metadata: { details: "Fact requires id, subject, source, key, and value" }
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
