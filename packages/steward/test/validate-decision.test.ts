import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import {
  isStewardDecision,
  STEWARD_OF_STEWARDS_ACTIONS,
  validateStewardDecision
} from "../src/validate/decision.js";

const finding = {
  id: "finding-1",
  kind: "rogue_steward" as const,
  subject: { kind: "steward" as const, id: "steward-rogue" },
  severity: "critical" as const,
  message: "Rogue steward action detected"
};

describe("steward decision validation", () => {
  it("accepts a well-formed decision", () => {
    const decision = {
      action: "vetoSteward" as const,
      finding,
      reason: "Repeated bad resolutions"
    };

    expect(isStewardDecision(decision)).toBe(true);
    expect(validateStewardDecision(decision)).toEqual(decision);
  });

  it("includes steward-of-stewards decision actions", () => {
    expect(STEWARD_OF_STEWARDS_ACTIONS).toEqual([
      "proposePenalty",
      "vetoSteward",
      "challengeStewardDecision"
    ]);
  });

  it("rejects decisions with unknown actions", () => {
    const decision = {
      action: "createMarket",
      finding,
      reason: "invalid"
    };

    expect(isStewardDecision(decision)).toBe(false);
    expect(() => validateStewardDecision(decision)).toThrow(LiveStreakConfigError);
  });
});
