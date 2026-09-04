import { describe, expect, it } from "vitest";
import { buildWriteIntentsFromDecision } from "../../src/model/write-intent.js";
import { detection, vaultDraft } from "../helpers/fixtures.js";

describe("buildWriteIntentsFromDecision", () => {
  const detected = detection();
  const draft = vaultDraft();

  it("builds createVault intent under marketId", () => {
    const intents = buildWriteIntentsFromDecision({
      action: "createVault",
      draft,
      detection: detected
    });

    expect(intents).toEqual([
      {
        action: "createVault",
        marketId: "market-1",
        question: draft.question,
        creatorSide: "yes",
        creatorStake: 5_000_000n,
        seedRate: 8_333n,
        resolutionSource: draft.resolutionSource,
        resolutionWindowExpiresAtMs: draft.resolutionWindow.expiresAtMs
      }
    ]);
  });

  it("builds joinExistingVault when decision joins", () => {
    const intents = buildWriteIntentsFromDecision({
      action: "joinVault",
      vaultId: "vault-9",
      draft,
      detection: detected
    });

    expect(intents).toEqual([
      {
        action: "joinExistingVault",
        marketId: "market-1",
        vaultId: "vault-9"
      }
    ]);
  });

  it("returns no intents for skip decisions", () => {
    const intents = buildWriteIntentsFromDecision({
      action: "skip",
      reason: "duplicate_vault",
      detection: detected
    });

    expect(intents).toEqual([]);
  });
});
