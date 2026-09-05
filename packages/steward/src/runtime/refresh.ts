import { LiveStreakConfigError } from "@livestreak/core";

import { planStewardActions } from "../workflow/action/plan.js";
import type { StewardActionContext } from "../workflow/action/types.js";
import type { StewardFact } from "../workflow/facts/fact.js";
import { chooseStewardDecisions } from "../workflow/decision/choose.js";
import type { StewardDecisionPolicy } from "../workflow/decision/types.js";
import type { StewardActionPlan } from "../model/action-plan.js";
import type { StewardDecision } from "../model/decision.js";
import type { StewardFinding } from "../model/finding.js";
import type { StewardSubject } from "../model/subject.js";
import { evaluateStewardRules } from "../workflow/rules/evaluate.js";
import type { StewardRuleset } from "../workflow/rules/types.js";
import { validateStewardFact } from "../validate/fact.js";
import type { StewardFactSources } from "./sources.js";
import type { StewardRuntimeLastError } from "./store.js";

// --- exports ---

export interface StewardSubjectRefreshResult {
  readonly subject: StewardSubject;
  readonly findings: readonly StewardFinding[];
  readonly decisions: readonly StewardDecision[];
}

export interface StewardRefreshResult {
  readonly perSubject: readonly StewardSubjectRefreshResult[];
  readonly latestFindings: readonly StewardFinding[];
  readonly latestDecisions: readonly StewardDecision[];
  readonly pendingActionPlans: readonly StewardActionPlan[];
}

export const refreshWatchedSubjects = async (input: {
  readonly watchedSubjects: readonly StewardSubject[];
  readonly ruleset: StewardRuleset;
  readonly decisionPolicy: StewardDecisionPolicy;
  readonly actionContext?: StewardActionContext;
  readonly sources: StewardFactSources;
}): Promise<StewardRefreshResult> => {
  const perSubject: StewardSubjectRefreshResult[] = [];
  const latestFindings: StewardFinding[] = [];
  const latestDecisions: StewardDecision[] = [];
  const pendingActionPlans: StewardActionPlan[] = [];

  for (const subject of input.watchedSubjects) {
    const facts = await collectFactsForSubject(subject, input.sources);
    const findings = evaluateStewardRules(subject, facts, input.ruleset);
    const decisions = chooseStewardDecisions(findings, input.decisionPolicy);
    const plans = planStewardActions(decisions, input.actionContext);

    perSubject.push({ subject, findings, decisions });
    latestFindings.push(...findings);
    latestDecisions.push(...decisions);
    pendingActionPlans.push(...plans);
  }

  return {
    perSubject,
    latestFindings,
    latestDecisions,
    pendingActionPlans
  };
};

export const toRuntimeLastError = (error: unknown): StewardRuntimeLastError => {
  if (error instanceof LiveStreakConfigError) {
    const details =
      typeof error.metadata?.details === "string" ? error.metadata.details : undefined;

    return {
      message: error.message,
      ...(details === undefined ? {} : { details })
    };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: "Unknown steward refresh failure", details: String(error) };
};

// --- helpers ---

const collectFactsForSubject = async (
  subject: StewardSubject,
  sources: StewardFactSources
): Promise<readonly StewardFact[]> => {
  const [contractRaw, hostRaw, observeRaw, memoryRaw] = await Promise.all([
    sources.contract.readFacts(subject),
    sources.host.readFacts(subject),
    sources.observe.readFacts(subject),
    sources.memory.readFacts(subject)
  ]);

  return [...contractRaw, ...hostRaw, ...observeRaw, ...memoryRaw].map(validateStewardFact);
};
