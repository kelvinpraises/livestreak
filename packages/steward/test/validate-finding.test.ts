import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import {
  isStewardFinding,
  validateStewardFinding
} from "../src/validate/finding.js";

const subject = {
  kind: "vault" as const,
  id: "vault-1",
  marketId: "market-1"
};

describe("steward finding validation", () => {
  it("accepts a well-formed finding", () => {
    const finding = {
      id: "finding-1",
      kind: "missing_evidence" as const,
      subject,
      severity: "warning" as const,
      message: "Manifest missing"
    };

    expect(isStewardFinding(finding)).toBe(true);
    expect(validateStewardFinding(finding)).toEqual(finding);
  });

  it("accepts optional TEE attestation metadata", () => {
    const finding = {
      id: "finding-tee",
      kind: "manual_note" as const,
      subject,
      severity: "info" as const,
      message: "TEE signed review",
      attestationRef: {
        quoteRef: "quote://abc",
        reportRef: "report://xyz",
        enclaveId: "enclave-1",
        signedAtMs: 1_700_000_000_000
      }
    };

    expect(validateStewardFinding(finding).attestationRef).toEqual(finding.attestationRef);
  });

  it("rejects findings with invalid severity", () => {
    const finding = {
      id: "finding-1",
      kind: "bad_evidence",
      subject,
      severity: "urgent",
      message: "Bad evidence"
    };

    expect(isStewardFinding(finding)).toBe(false);
    expect(() => validateStewardFinding(finding)).toThrow(LiveStreakConfigError);
  });

  it("rejects empty evidenceRefs array", () => {
    const finding = {
      id: "finding-1",
      kind: "missing_evidence" as const,
      subject,
      severity: "warning" as const,
      message: "Manifest missing",
      evidenceRefs: []
    };

    expect(isStewardFinding(finding)).toBe(false);
  });

  it("rejects evidenceRefs with empty string among valid refs", () => {
    const finding = {
      id: "finding-1",
      kind: "missing_evidence" as const,
      subject,
      severity: "warning" as const,
      message: "Manifest missing",
      evidenceRefs: ["ref-1", ""]
    };

    expect(isStewardFinding(finding)).toBe(false);
  });

  it("rejects non-finite createdAtMs", () => {
    const base = {
      id: "finding-1",
      kind: "manual_note" as const,
      subject,
      severity: "info" as const,
      message: "Note"
    };

    expect(isStewardFinding({ ...base, createdAtMs: Number.NaN })).toBe(false);
    expect(isStewardFinding({ ...base, createdAtMs: Number.POSITIVE_INFINITY })).toBe(false);
  });
});
