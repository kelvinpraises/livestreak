import type { StewardActionPlan } from "../model/action-plan.js";

// --- exports ---

export interface StewardActionPlanSink {
  readonly submit: (plans: readonly StewardActionPlan[]) => Promise<void> | void;
}
