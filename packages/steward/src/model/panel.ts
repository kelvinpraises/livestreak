import type { StewardActionPlan } from "./action-plan.js";
import type { StewardDecision } from "./decision.js";
import type { StewardFinding } from "./finding.js";
import type { StewardSubject } from "./subject.js";

// --- exports ---

export interface StewardPanelSummary {
  readonly watchedSubjectCount: number;
  readonly findingCount: number;
  readonly pendingPlanCount: number;
  readonly completedPlanCount: number;
  readonly criticalFindingCount: number;
}

export interface StewardPanelView {
  readonly runtimeId: string;
  readonly watchedSubjects: readonly StewardSubject[];
  readonly latestFindings: readonly StewardFinding[];
  readonly latestDecision?: StewardDecision;
  readonly pendingActionPlan?: StewardActionPlan;
  readonly completedActionPlans: readonly StewardActionPlan[];
  readonly lastError?: string;
  readonly updatedAtMs?: number;
  readonly summary?: StewardPanelSummary;
}
