import { describe, expect, it } from "vitest";
import { validateVaultDraft } from "../../src/validate/vault-draft.js";
import { vaultDraft } from "../helpers/fixtures.js";

describe("validateVaultDraft", () => {
  it("rejects invalid binary draft fields", () => {
    const result = validateVaultDraft({
      marketId: "",
      question: "",
      outcomeKind: "multi",
      sides: ["yes"],
      resolutionSource: "",
      resolutionWindow: { expiresAtMs: Number.NaN },
      fundingToken: ""
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          "marketId must be a non-empty string",
          "question must be a non-empty string",
          'outcomeKind must be "binary"',
          'sides must be ["yes", "no"]',
          "resolutionSource must be a non-empty string",
          "resolutionWindow.expiresAtMs must be a finite number",
          "fundingToken must be a non-empty string"
        ])
      );
    }
  });

  it("rejects resolution windows that open after they expire", () => {
    const result = validateVaultDraft(
      vaultDraft({
        resolutionWindow: {
          opensAtMs: 2_000,
          expiresAtMs: 1_000
        }
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues).toContain("resolutionWindow.opensAtMs must be before expiresAtMs");
    }
  });

  it("accepts a valid vault draft", () => {
    const result = validateVaultDraft(vaultDraft());

    expect(result.ok).toBe(true);
  });
});
