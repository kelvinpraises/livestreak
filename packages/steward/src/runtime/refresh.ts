import { LiveStreakConfigError } from "@livestreak/core";

import { planStewardActions } from "../action/plan.js";
import type { StewardActionContext } from "../action/types.js";
import type { StewardFact } from "../facts/fact.js";
import { chooseStewardDecisions } from "../decision/choose.js";
import type { StewardDecisionPolicy } from "../decision/types.js";
import type { StewardActionPlan } from "../model/action-plan.js";
import type { StewardDecision } from "../model/decision.js";
import type { StewardFinding } from "../model/finding.js";
import type { StewardSubject } from "../model/subject.js";
import { evaluateStewardRules } from "../rules/evaluate.js";
import type { StewardRuleset } from "../rules/types.js";
import { validateStewardFact } from "../validate/fact.js";
import type { StewardFactSources } from "./sources.js";
import type { StewardRuntimeLastError } from "./store.js";

// --- exports ---

export interface StewardRefreshResult {
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
  const latestFindings: StewardFinding[] = [];
  const latestDecisions: StewardDecision[] = [];
  const pendingActionPlans: StewardActionPlan[] = [];

  for (const subject of input.watchedSubjects) {
    const facts = await collectFactsForSubject(subject, input.sources);
    const findings = evaluateStewardRules(subject, facts, input.ruleset);
    const decisions = chooseStewardDecisions(findings, input.decisionPolicy);
    const plans = planStewardActions(decisions, input.actionContext);

    latestFindings.push(...findings);
    latestDecisions.push(...decisions);
    pendingActionPlans.push(...plans);
  }

  return {
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
  const [contractRaw, hostRaw, observeRaw] = await Promise.all([
    sources.contract.readFacts(subject),
    sources.host.readFacts(subject),
    sources.observe.readFacts(subject)
  ]);

  return [...contractRaw, ...hostRaw, ...observeRaw].map(validateStewardFact);
};
