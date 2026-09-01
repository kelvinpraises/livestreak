import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { isStewardFact, validateStewardFact } from "../src/validate/fact.js";

const subject = {
  kind: "vault" as const,
  id: "vault-1",
  marketId: "market-1"
};

describe("steward fact validation", () => {
  it("accepts a well-formed fact", () => {
    const fact = {
      id: "fact-1",
      subject,
      source: "contract" as const,
      key: "vault_status",
      value: "active"
    };

    expect(isStewardFact(fact)).toBe(true);
    expect(validateStewardFact(fact)).toEqual(fact);
  });

  it("accepts optional TEE attestation metadata on facts", () => {
    const fact = {
      id: "fact-tee",
      subject,
      source: "observe" as const,
      key: "manifest_status",
      value: "missing",
      attestationRef: { quoteRef: "quote://1", signedAtMs: 1_700_000_000_000 }
    };

    expect(validateStewardFact(fact).attestationRef).toEqual(fact.attestationRef);
  });

  it("rejects facts with invalid source", () => {
    const fact = {
      id: "fact-1",
      subject,
      source: "forum",
      key: "thread_count",
      value: 0
    };

    expect(isStewardFact(fact)).toBe(false);
    expect(() => validateStewardFact(fact)).toThrow(LiveStreakConfigError);
  });

  it("rejects facts with empty id or key", () => {
    expect(
      isStewardFact({
        id: "",
        subject,
        source: "host",
        key: "cache_receipt_count",
        value: 0
      })
    ).toBe(false);

    expect(
      isStewardFact({
        id: "fact-1",
        subject,
        source: "host",
        key: "   ",
        value: 0
      })
    ).toBe(false);
  });

  it("rejects evidenceRefs with empty strings", () => {
    const fact = {
      id: "fact-1",
      subject,
      source: "observe",
      key: "evidence",
      value: true,
      evidenceRefs: ["ref-1", ""]
    };

    expect(isStewardFact(fact)).toBe(false);
    expect(() => validateStewardFact(fact)).toThrow(LiveStreakConfigError);
  });

  it("rejects empty evidenceRefs array", () => {
    const fact = {
      id: "fact-1",
      subject,
      source: "observe",
      key: "evidence",
      value: true,
      evidenceRefs: []
    };

    expect(isStewardFact(fact)).toBe(false);
  });

  it("rejects evidenceRefs with empty string among valid refs", () => {
    const fact = {
      id: "fact-1",
      subject,
      source: "observe",
      key: "evidence",
      value: true,
      evidenceRefs: ["ok", ""]
    };

    expect(isStewardFact(fact)).toBe(false);
  });

  it("rejects non-finite observedAtMs", () => {
    const fact = {
      id: "fact-1",
      subject,
      source: "host",
      key: "cache_receipt_count",
      value: 0,
      observedAtMs: Number.NaN
    };

    expect(isStewardFact(fact)).toBe(false);
  });

  it("rejects invalid attestation shape on facts", () => {
    const fact = {
      id: "fact-1",
      subject,
      source: "observe",
      key: "manifest_status",
      value: "missing",
      attestationRef: { signedAtMs: Number.POSITIVE_INFINITY }
    };

    expect(isStewardFact(fact)).toBe(false);
  });
});
