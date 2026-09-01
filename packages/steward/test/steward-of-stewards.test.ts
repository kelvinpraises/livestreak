import { describe, expect, it } from "vitest";

import { chooseStewardDecisions } from "../src/decision/choose.js";
import { planStewardActions } from "../src/action/plan.js";
import { STEWARD_OF_STEWARDS_ACTIONS } from "../src/validate/decision.js";

const rogueFinding = {
  id: "finding-rogue",
  kind: "rogue_steward" as const,
  subject: { kind: "steward" as const, id: "steward-bad" },
  severity: "critical" as const,
  message: "Rogue steward"
};

describe("steward-of-stewards surface", () => {
  it("exposes veto, penalty, and challenge decision actions", () => {
    expect(STEWARD_OF_STEWARDS_ACTIONS).toContain("vetoSteward");
    expect(STEWARD_OF_STEWARDS_ACTIONS).toContain("proposePenalty");
    expect(STEWARD_OF_STEWARDS_ACTIONS).toContain("challengeStewardDecision");
  });

  it("plans steward registry contract calls for steward-of-stewards decisions", () => {
    const decisions = chooseStewardDecisions([rogueFinding], {
      id: "steward-of-stewards",
      mappings: [
        {
          findingKind: "rogue_steward",
          action: "vetoSteward",
          reason: "Veto rogue steward"
        }
      ]
    });

    const plans = planStewardActions(decisions, { targetStewardId: "steward-bad" });

    expect(plans[0]?.contractCalls).toEqual([
      {
        contract: "stewardRegistry",
        functionName: "vetoSteward",
        args: ["steward-bad", "Veto rogue steward"]
      }
    ]);
    expect(plans[0]?.hostActions).toEqual([]);
  });

  it("plans challenge steward decision with optional host append message", () => {
    const decision = {
      action: "challengeStewardDecision" as const,
      finding: rogueFinding,
      reason: "Challenge prior steward decision"
    };

    const [plan] = planStewardActions([decision], {
      targetStewardId: "steward-bad",
      forumThreadId: "thread-1"
    });

    expect(plan?.contractCalls[0]?.functionName).toBe("challengeStewardDecision");
    expect(plan?.hostActions[0]?.kind).toBe("appendMessage");
    expect(plan?.hostActions[0]?.payload).toMatchObject({
      threadId: "thread-1",
      message: "Challenge prior steward decision"
    });
  });
});
