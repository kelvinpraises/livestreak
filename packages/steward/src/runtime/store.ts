import type { StewardActionPlan } from "../model/action-plan.js";
import type { StewardDecision } from "../model/decision.js";
import type { StewardFinding } from "../model/finding.js";
import type { StewardSubject } from "../model/subject.js";
import type { StewardStateSnapshot } from "../panel/types.js";

// --- exports ---

export interface StewardRuntimeLastError {
  readonly message: string;
  readonly details?: string;
}

export interface StewardRuntimeStore {
  readSnapshot: () => StewardStateSnapshot;
  writeRefresh: (input: {
    readonly watchedSubjects: readonly StewardSubject[];
    readonly latestFindings: readonly StewardFinding[];
    readonly latestDecisions: readonly StewardDecision[];
    readonly pendingActionPlans: readonly StewardActionPlan[];
  }) => void;
  setLastError: (error: StewardRuntimeLastError | undefined) => void;
}

export const createStewardRuntimeStore = (runtimeId: string): StewardRuntimeStore =>
  new StewardRuntimeStoreInMemory(runtimeId);

// --- helpers ---

class StewardRuntimeStoreInMemory implements StewardRuntimeStore {
  private snapshot: StewardStateSnapshot;

  constructor(private readonly runtimeId: string) {
    this.snapshot = {
      runtimeId,
      watchedSubjects: [],
      latestFindings: [],
      completedActionPlans: []
    };
  }

  readSnapshot(): StewardStateSnapshot {
    return {
      ...this.snapshot,
      watchedSubjects: [...this.snapshot.watchedSubjects],
      latestFindings: [...this.snapshot.latestFindings],
      ...(this.snapshot.latestDecisions === undefined
        ? {}
        : { latestDecisions: [...this.snapshot.latestDecisions] }),
      ...(this.snapshot.pendingActionPlans === undefined
        ? {}
        : { pendingActionPlans: [...this.snapshot.pendingActionPlans] }),
      completedActionPlans: [...(this.snapshot.completedActionPlans ?? [])]
    };
  }

  writeRefresh(input: {
    readonly watchedSubjects: readonly StewardSubject[];
    readonly latestFindings: readonly StewardFinding[];
    readonly latestDecisions: readonly StewardDecision[];
    readonly pendingActionPlans: readonly StewardActionPlan[];
  }): void {
    this.snapshot = {
      runtimeId: this.runtimeId,
      watchedSubjects: [...input.watchedSubjects],
      latestFindings: [...input.latestFindings],
      latestDecisions: [...input.latestDecisions],
      pendingActionPlans: [...input.pendingActionPlans],
      completedActionPlans: [...(this.snapshot.completedActionPlans ?? [])],
      updatedAtMs: Date.now(),
      ...(this.snapshot.lastError === undefined ? {} : { lastError: this.snapshot.lastError })
    };
  }

  setLastError(error: StewardRuntimeLastError | undefined): void {
    this.snapshot = {
      ...this.snapshot,
      ...(error === undefined ? {} : { lastError: error.details ?? error.message }),
      updatedAtMs: Date.now()
    };
  }
}
