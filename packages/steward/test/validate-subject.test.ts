import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import {
  isStewardSubject,
  STEWARD_SUBJECT_KINDS,
  validateStewardSubject,
  validateStewardSubjectKind
} from "../src/validate/subject.js";

describe("steward subject validation", () => {
  it("accepts all subject kinds", () => {
    for (const kind of STEWARD_SUBJECT_KINDS) {
      expect(validateStewardSubjectKind(kind)).toBe(kind);
    }
  });

  it("rejects invalid subject kinds", () => {
    expect(() => validateStewardSubjectKind("moderator")).toThrow(LiveStreakConfigError);
  });

  it("accepts a well-formed subject", () => {
    const subject = {
      kind: "vault" as const,
      id: "vault-1",
      marketId: "market-1"
    };

    expect(isStewardSubject(subject)).toBe(true);
    expect(validateStewardSubject(subject)).toEqual(subject);
  });

  it("rejects subjects without id", () => {
    expect(isStewardSubject({ kind: "market", id: "" })).toBe(false);
    expect(() => validateStewardSubject({ kind: "market", id: "" })).toThrow(
      LiveStreakConfigError
    );
  });
});
