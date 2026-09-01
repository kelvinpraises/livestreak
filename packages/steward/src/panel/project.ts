import type { StewardPanelView } from "../model/panel.js";
import type { StewardPanelInput } from "./types.js";

// --- exports ---

export const projectStewardPanel = (stateOrSnapshot: StewardPanelInput): StewardPanelView => {
  const pending = readPendingPlans(stateOrSnapshot);
  const completed = readCompletedPlans(stateOrSnapshot);
  const decisions = readDecisions(stateOrSnapshot);

  return {
    runtimeId: stateOrSnapshot.runtimeId,
    watchedSubjects: [...stateOrSnapshot.watchedSubjects],
    latestFindings: [...stateOrSnapshot.latestFindings],
    ...(decisions.length > 0 ? { latestDecision: decisions[decisions.length - 1] } : {}),
    ...(pending.length > 0 ? { pendingActionPlan: pending[0] } : {}),
    completedActionPlans: completed,
    ...(stateOrSnapshot.lastError === undefined ? {} : { lastError: stateOrSnapshot.lastError }),
    ...(stateOrSnapshot.updatedAtMs === undefined
      ? {}
      : { updatedAtMs: stateOrSnapshot.updatedAtMs }),
    summary: {
      watchedSubjectCount: stateOrSnapshot.watchedSubjects.length,
      findingCount: stateOrSnapshot.latestFindings.length,
      pendingPlanCount: pending.length,
      completedPlanCount: completed.length,
      criticalFindingCount: stateOrSnapshot.latestFindings.filter(
        (finding) => finding.severity === "critical"
      ).length
    }
  };
};

// --- helpers ---

const readPendingPlans = (input: StewardPanelInput) => {
  if ("pendingActionPlans" in input && input.pendingActionPlans !== undefined) {
    return [...input.pendingActionPlans];
  }

  if ("pendingActionPlan" in input && input.pendingActionPlan !== undefined) {
    return [input.pendingActionPlan];
  }

  return [];
};

const readCompletedPlans = (input: StewardPanelInput) => {
  if ("completedActionPlans" in input && input.completedActionPlans !== undefined) {
    return [...input.completedActionPlans];
  }

  return [];
};

const readDecisions = (input: StewardPanelInput) => {
  if ("latestDecisions" in input && input.latestDecisions !== undefined) {
    return [...input.latestDecisions];
  }

  if ("latestDecision" in input && input.latestDecision !== undefined) {
    return [input.latestDecision];
  }

  return [];
};
