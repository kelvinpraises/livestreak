import { describe, expect, it } from "vitest";

import { isTeeAttestationRef } from "../src/facts/tee.js";
import { evaluateStewardRules } from "../src/rules/evaluate.js";

const subject = { kind: "vault" as const, id: "vault-1", marketId: "market-1" };

describe("TEE attestation metadata", () => {
  it("recognizes optional attestation refs without execution hooks", () => {
    const attestation = {
      quoteRef: "quote://1",
      reportRef: "report://1"
    };

    expect(isTeeAttestationRef(attestation)).toBe(true);
    expect(isTeeAttestationRef("quote://inline")).toBe(false);
  });

  it("rejects non-finite signedAtMs", () => {
    expect(isTeeAttestationRef({ signedAtMs: Number.NaN })).toBe(false);
    expect(isTeeAttestationRef({ signedAtMs: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("rejects empty string attestation refs", () => {
    expect(isTeeAttestationRef({ quoteRef: "" })).toBe(false);
    expect(isTeeAttestationRef({ reportRef: "   " })).toBe(false);
  });

  it("rejects attestation without a real reference field", () => {
    expect(isTeeAttestationRef({})).toBe(false);
    expect(isTeeAttestationRef({ signedAtMs: 123 })).toBe(false);
  });

  it("accepts attestation with quoteRef and finite signedAtMs", () => {
    expect(
      isTeeAttestationRef({ quoteRef: "quote://1", signedAtMs: 1_700_000_000_000 })
    ).toBe(true);
  });

  it("carries attestation metadata through rule evaluation only as fact input", () => {
    const findings = evaluateStewardRules(
      subject,
      [
        {
          id: "fact-1",
          subject,
          source: "observe",
          key: "manifest_status",
          value: "missing",
          attestationRef: { quoteRef: "quote://missing-manifest" },
          observedAtMs: 100
        }
      ],
      {
        id: "evidence-rules",
        rules: [
          {
            id: "missing-manifest",
            findingKind: "missing_evidence",
            condition: { type: "fact_equals", key: "manifest_status", value: "missing" },
            severity: "warning",
            message: "Manifest missing"
          }
        ]
      }
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("missing_evidence");
    expect(findings[0]).not.toHaveProperty("enclave");
    expect(findings[0]).not.toHaveProperty("runTee");
  });
});
