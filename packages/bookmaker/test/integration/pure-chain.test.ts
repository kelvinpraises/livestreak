import { describe, expect, it } from "vitest";
import { detectOpportunity } from "../../src/detection/evaluate.js";
import { createEventKindDetector } from "../../src/detection/factories.js";
import { buildVaultDraft } from "../../src/draft/build.js";
import { chooseVaultAction } from "../../src/decision/choose.js";
import { planBookmakerWrite } from "../../src/write/plan.js";
import { marketContext, similarityResult } from "../helpers/fixtures.js";

describe("pure detection to write-intent chain", () => {
  const nowMs = 10_000;
  const context = marketContext();
  const fundingToken = "0x0000000000000000000000000000000000000002";
  const contracts = { vaultAddress: "0x00000000000000000000000000000000000000aa" };

  it("runs events through detection, draft, decision, and write planning without host or chain calls", () => {
    const detector = createEventKindDetector({
      id: "signal-detector",
      kind: "goal-chance",
      question: "Will Team A score in the next 10 minutes?",
      vaultType: "momentum",
      durationSeconds: 600,
      confidence: 0.92,
      suggestedSide: "yes"
    });

    const evaluation = detectOpportunity({
      marketContext: context,
      events: [
        {
          marketId: "market-1",
          observationId: "obs-goal",
          observedAtMs: nowMs,
          kind: "goal-chance",
          payload: { pressure: 0.8 }
        }
      ],
      detectors: [detector],
      policy: { confidenceThreshold: 0.8 },
      nowMs
    });

    expect(evaluation.action).toBe("detected");
    if (evaluation.action !== "detected") {
      return;
    }

    const draft = buildVaultDraft(evaluation.detection, context, { fundingToken, nowMs });
    expect(draft.marketId).toBe("market-1");
    expect(draft.resolutionWindow).toEqual({
      opensAtMs: nowMs,
      expiresAtMs: nowMs + 600_000
    });

    const decision = chooseVaultAction(draft, similarityResult(), {
      duplicatePolicy: "always-create",
      detection: evaluation.detection
    });

    expect(decision.action).toBe("createVault");

    const plan = planBookmakerWrite(
      {
        action: "createVault",
        draft,
        detection: evaluation.detection
      },
      contracts
    );

    expect(plan.intents).toEqual([
      {
        action: "createVault",
        marketId: "market-1",
        draft
      }
    ]);
  });
});
