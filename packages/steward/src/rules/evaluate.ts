import type { StewardFact } from "../facts/fact.js";
import type { StewardFinding } from "../model/finding.js";
import type { StewardSubject } from "../model/subject.js";
import type { StewardRule, StewardRuleCondition, StewardRuleset } from "./types.js";

// --- exports ---

export const evaluateStewardRules = (
  subject: StewardSubject,
  facts: readonly StewardFact[],
  ruleset: StewardRuleset
): StewardFinding[] => {
  const subjectFacts = facts.filter((fact) => fact.subject.id === subject.id);

  return ruleset.rules.flatMap((rule) => {
    if (!matchesCondition(rule.condition, subjectFacts)) {
      return [];
    }

    return [
      {
        id: `${ruleset.id}:${rule.id}:${subject.id}`,
        kind: rule.findingKind,
        subject,
        severity: rule.severity,
        message: rule.message,
        evidenceRefs: collectEvidenceRefs(subjectFacts, rule.condition),
        createdAtMs: latestObservedAtMs(subjectFacts)
      } satisfies StewardFinding
    ];
  });
};

// --- helpers ---

const matchesCondition = (condition: StewardRuleCondition, facts: readonly StewardFact[]): boolean => {
  switch (condition.type) {
    case "fact_present":
      return facts.some((fact) => fact.key === condition.key);
    case "fact_missing":
      return !facts.some((fact) => fact.key === condition.key);
    case "fact_equals":
      return facts.some(
        (fact) => fact.key === condition.key && deepEqual(fact.value, condition.value)
      );
    case "fact_truthy":
      return facts.some((fact) => fact.key === condition.key && isTruthy(fact.value));
  }
};

const collectEvidenceRefs = (
  facts: readonly StewardFact[],
  condition: StewardRuleCondition
): readonly string[] | undefined => {
  const key = conditionKey(condition);
  if (key === undefined) {
    return undefined;
  }

  const refs = facts
    .filter((fact) => fact.key === key)
    .flatMap((fact) => fact.evidenceRefs ?? []);

  return refs.length > 0 ? [...new Set(refs)] : undefined;
};

const conditionKey = (condition: StewardRuleCondition): string | undefined => {
  switch (condition.type) {
    case "fact_present":
    case "fact_missing":
    case "fact_equals":
    case "fact_truthy":
      return condition.key;
  }
};

const latestObservedAtMs = (facts: readonly StewardFact[]): number | undefined => {
  const timestamps = facts
    .map((fact) => fact.observedAtMs)
    .filter((value): value is number => typeof value === "number");

  return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
};

const isTruthy = (value: unknown): boolean => {
  if (value === false || value === 0 || value === "" || value === null || value === undefined) {
    return false;
  }

  return true;
};

const deepEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) {
    return true;
  }

  if (typeof left !== typeof right) {
    return false;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((entry, index) => deepEqual(entry, right[index]));
  }

  if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);

    for (const key of keys) {
      if (!deepEqual(leftRecord[key], rightRecord[key])) {
        return false;
      }
    }

    return true;
  }

  return false;
};
