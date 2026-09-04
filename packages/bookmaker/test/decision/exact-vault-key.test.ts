import { describe, expect, it } from "vitest";
import { chooseVaultAction } from "../../src/decision/choose.js";
import { idempotencyKeyFromDraft } from "../../src/model/idempotency.js";
import { detection, similarityResult, vaultDraft } from "../helpers/fixtures.js";

describe("chooseVaultAction exact vaultKey match", () => {
  it("joins an existing vault when a candidate vaultKey matches the draft", () => {
    const draft = vaultDraft();
    const draftKey = idempotencyKeyFromDraft(draft);

    const decision = chooseVaultAction(
      draft,
      similarityResult({
        candidates: [
          {
            kind: "vault",
            vaultId: "vault-exact",
            marketId: "market-1",
            score: 0.2,
            reason: "indexed vault",
            suggestedAction: "create-new",
            vaultKey: draftKey
          }
        ]
      }),
      {
        duplicatePolicy: "always-create",
        detection: detection()
      }
    );

    expect(decision.action).toBe("joinVault");
    if (decision.action === "joinVault") {
      expect(decision.vaultId).toBe("vault-exact");
    }
  });
});
