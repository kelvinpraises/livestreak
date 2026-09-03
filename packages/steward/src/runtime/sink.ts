import type { StewardActionPlan } from "../model/action-plan.js";
import type { StewardDecision } from "../model/decision.js";
import type { StewardFinding } from "../model/finding.js";
import type { StewardSubject } from "../model/subject.js";

// --- exports ---

export interface StewardActionPlanSink {
  readonly submit: (plans: readonly StewardActionPlan[]) => Promise<void> | void;
}

export interface StewardMemoryRememberInput {
  readonly subject: StewardSubject;
  readonly findings: readonly StewardFinding[];
  readonly decisions: readonly StewardDecision[];
}

export interface StewardMemorySink {
  readonly remember: (input: StewardMemoryRememberInput) => Promise<void> | void;
}
