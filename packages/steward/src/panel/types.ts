import type { StewardActionPlan } from "../model/action-plan.js";
import type { StewardDecision } from "../model/decision.js";
import type { StewardFinding } from "../model/finding.js";
import type { StewardPanelView } from "../model/panel.js";
import type { StewardSubject } from "../model/subject.js";

// --- exports ---

export interface StewardStateSnapshot {
  readonly runtimeId: string;
  readonly watchedSubjects: readonly StewardSubject[];
  readonly latestFindings: readonly StewardFinding[];
  readonly latestDecisions?: readonly StewardDecision[];
  readonly pendingActionPlans?: readonly StewardActionPlan[];
  readonly completedActionPlans?: readonly StewardActionPlan[];
  readonly lastError?: string;
  readonly updatedAtMs?: number;
}

export type StewardPanelInput = StewardStateSnapshot | StewardPanelView;
