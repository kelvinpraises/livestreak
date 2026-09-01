import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import {
  isStewardActionPlan,
  validateStewardActionPlan
} from "../src/validate/action-plan.js";

const subject = { kind: "market" as const, id: "market-1" };

const decision = {
  action: "annotate" as const,
  finding: {
    id: "finding-1",
    kind: "manual_note" as const,
    subject,
    severity: "info" as const,
    message: "Note"
  },
  reason: "Record annotation"
};

describe("steward action plan validation", () => {
  it("accepts a well-formed action plan", () => {
    const plan = {
      decision,
      contractCalls: [],
      hostActions: [
        {
          kind: "annotate" as const,
          payload: {
            subject,
            message: "Record annotation",
            findingId: "finding-1"
          }
        }
      ]
    };

    expect(isStewardActionPlan(plan)).toBe(true);
    expect(validateStewardActionPlan(plan)).toEqual(plan);
  });

  it("accepts typed vault and steward registry contract calls", () => {
    const plan = {
      decision,
      contractCalls: [
        {
          contract: "vault" as const,
          functionName: "triggerHot" as const,
          args: ["vault-1", "Escalate"]
        },
        {
          contract: "stewardRegistry" as const,
          functionName: "challengeProposal" as const,
          args: ["proposal-1", 0]
        }
      ],
      hostActions: []
    };

    expect(isStewardActionPlan(plan)).toBe(true);
  });

  it("rejects unknown contract names", () => {
    const plan = {
      decision,
      contractCalls: [{ contract: "marketFactory", functionName: "createMarket", args: [] }],
      hostActions: []
    };

    expect(isStewardActionPlan(plan)).toBe(false);
    expect(() => validateStewardActionPlan(plan)).toThrow(LiveStreakConfigError);
  });

  it("rejects unknown function names for a known contract", () => {
    const plan = {
      decision,
      contractCalls: [{ contract: "vault", functionName: "createVault", args: ["vault-1", "x"] }],
      hostActions: []
    };

    expect(isStewardActionPlan(plan)).toBe(false);
  });

  it("rejects contract calls with wrong arg count", () => {
    const plan = {
      decision,
      contractCalls: [{ contract: "vault", functionName: "resolve", args: ["vault-1"] }],
      hostActions: []
    };

    expect(isStewardActionPlan(plan)).toBe(false);
  });

  it("rejects contract calls with empty string args", () => {
    const plan = {
      decision,
      contractCalls: [{ contract: "vault", functionName: "resolve", args: ["", "reason"] }],
      hostActions: []
    };

    expect(isStewardActionPlan(plan)).toBe(false);
  });

  it("rejects challengeProposal with non-number side arg", () => {
    const plan = {
      decision,
      contractCalls: [
        {
          contract: "stewardRegistry",
          functionName: "challengeProposal",
          args: ["proposal-1", "zero"]
        }
      ],
      hostActions: []
    };

    expect(isStewardActionPlan(plan)).toBe(false);
  });

  it("rejects challengeStewardDecision with missing finding id arg", () => {
    const plan = {
      decision,
      contractCalls: [
        {
          contract: "stewardRegistry",
          functionName: "challengeStewardDecision",
          args: ["steward-1", "reason-only"]
        }
      ],
      hostActions: []
    };

    expect(isStewardActionPlan(plan)).toBe(false);
  });

  it("rejects host actions with untyped annotate payload", () => {
    const plan = {
      decision,
      contractCalls: [],
      hostActions: [{ kind: "annotate", payload: { message: "missing subject and findingId" } }]
    };

    expect(isStewardActionPlan(plan)).toBe(false);
  });

  it("rejects openThread payload without title", () => {
    const plan = {
      decision,
      contractCalls: [],
      hostActions: [{ kind: "openThread", payload: { subject, title: "" } }]
    };

    expect(isStewardActionPlan(plan)).toBe(false);
  });

  it("rejects appendMessage payload without message", () => {
    const plan = {
      decision,
      contractCalls: [],
      hostActions: [{ kind: "appendMessage", payload: { subject, message: "" } }]
    };

    expect(isStewardActionPlan(plan)).toBe(false);
  });
});
