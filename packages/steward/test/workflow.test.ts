import { describe, expect, it } from "vitest";

import {
  chooseStewardDecisions,
  evaluateStewardRules,
  planStewardActions,
  projectStewardPanel
} from "../src/index.js";

const subject = { kind: "vault" as const, id: "vault-1", marketId: "market-1", vaultId: "vault-1" };

describe("steward pure workflow", () => {
  it("flows subject -> facts -> findings -> decisions -> action plans", () => {
    const facts = [
      {
        id: "fact-cache",
        subject,
        source: "host" as const,
        key: "cache_receipt_count",
        value: 0,
        observedAtMs: 200
      }
    ];

    const findings = evaluateStewardRules(subject, facts, {
      id: "vault-health",
      rules: [
        {
          id: "missing-cache",
          findingKind: "missing_evidence",
          condition: { type: "fact_equals", key: "cache_receipt_count", value: 0 },
          severity: "warning",
          message: "Cache receipt missing"
        }
      ]
    });

    const decisions = chooseStewardDecisions(findings, {
      id: "default-policy",
      mappings: [
        {
          findingKind: "missing_evidence",
          action: "openThread",
          reason: "Discuss missing cache evidence"
        }
      ]
    });

    const plans = planStewardActions(decisions, { stewardId: "steward-1" });

    expect(findings).toHaveLength(1);
    expect(decisions[0]?.action).toBe("openThread");
    expect(plans[0]?.hostActions[0]?.kind).toBe("openThread");
    expect(plans[0]?.contractCalls).toEqual([]);
  });

  it("projects panel summary from a runtime snapshot", () => {
    const finding = {
      id: "finding-1",
      kind: "market_hot" as const,
      subject: { kind: "market" as const, id: "market-1" },
      severity: "critical" as const,
      message: "Market hot"
    };

    const panel = projectStewardPanel({
      runtimeId: "runtime-1",
      watchedSubjects: [subject],
      latestFindings: [finding],
      latestDecisions: [
        {
          action: "triggerHot" as const,
          finding,
          reason: "Escalate hot market"
        }
      ],
      pendingActionPlans: [
        {
          decision: {
            action: "triggerHot" as const,
            finding,
            reason: "Escalate hot market"
          },
          contractCalls: [
            {
              contract: "vault" as const,
              functionName: "triggerHot",
              args: ["vault-1", "Escalate hot market"]
            }
          ],
          hostActions: []
        }
      ],
      completedActionPlans: [],
      updatedAtMs: 300
    });

    expect(panel.summary).toEqual({
      watchedSubjectCount: 1,
      findingCount: 1,
      pendingPlanCount: 1,
      completedPlanCount: 0,
      criticalFindingCount: 1
    });
    expect(panel.latestDecision?.action).toBe("triggerHot");
    expect(panel.pendingActionPlan?.contractCalls[0]?.functionName).toBe("triggerHot");
  });
});
