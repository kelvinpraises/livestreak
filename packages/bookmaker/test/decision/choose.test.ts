import { describe, expect, it } from "vitest";
import { chooseVaultAction } from "../../src/decision/choose.js";
import { detection, similarityResult, vaultDraft } from "../helpers/fixtures.js";

describe("chooseVaultAction", () => {
  const draft = vaultDraft();
  const detected = detection();

  it("skips when similarity is scoped to a different marketId", () => {
    const decision = chooseVaultAction(
      draft,
      similarityResult({ marketId: "market-2" }),
      {
        duplicatePolicy: "prefer-join",
        detection: detected
      }
    );

    expect(decision).toEqual({
      action: "skip",
      reason: "market_not_found",
      detection: detected
    });
  });

  it("joins an existing vault when policy prefers join", () => {
    const decision = chooseVaultAction(
      draft,
      similarityResult({
        candidates: [
          {
            kind: "vault",
            vaultId: "vault-9",
            marketId: "market-1",
            score: 0.92,
            reason: "near-duplicate",
            suggestedAction: "join-existing"
          }
        ]
      }),
      {
        duplicatePolicy: "prefer-join",
        detection: detected
      }
    );

    expect(decision).toEqual({
      action: "joinVault",
      vaultId: "vault-9",
      draft,
      detection: detected
    });
  });

  it("creates a new vault when no join candidate exists", () => {
    const decision = chooseVaultAction(draft, similarityResult(), {
      duplicatePolicy: "always-create",
      detection: detected
    });

    expect(decision).toEqual({
      action: "createVault",
      draft,
      detection: detected
    });
  });

  it("skips on high duplicate risk when policy demands it", () => {
    const decision = chooseVaultAction(
      draft,
      similarityResult({ duplicateRisk: "high" }),
      {
        duplicatePolicy: "skip-on-high",
        detection: detected
      }
    );

    expect(decision).toEqual({
      action: "skip",
      reason: "duplicate_vault",
      detection: detected
    });
  });

  it("skips on steward warnings", () => {
    const decision = chooseVaultAction(
      draft,
      similarityResult({ stewardWarnings: ["rogue bookmaker pattern"] }),
      {
        duplicatePolicy: "always-create",
        detection: detected
      }
    );

    expect(decision).toEqual({
      action: "skip",
      reason: "steward_warning",
      detection: detected
    });
  });
});
