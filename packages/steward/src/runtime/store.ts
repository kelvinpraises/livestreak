import type { StewardActionPlan } from "../model/action-plan.js";
import type { StewardDecision } from "../model/decision.js";
import type { StewardFinding } from "../model/finding.js";
import type { StewardSubject } from "../model/subject.js";

// --- exports ---

export interface StewardStateSnapshot {
  readonly runtimeId: string;
  readonly revision: number;
  readonly watchedSubjects: readonly StewardSubject[];
  readonly latestFindings: readonly StewardFinding[];
  readonly latestDecisions?: readonly StewardDecision[];
  readonly pendingActionPlans?: readonly StewardActionPlan[];
  readonly lastError?: string;
  readonly updatedAtMs?: number;
}

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
  private revision = 0;
  private snapshot: StewardStateSnapshot;

  constructor(private readonly runtimeId: string) {
    this.snapshot = {
      runtimeId,
      revision: 0,
      watchedSubjects: [],
      latestFindings: []
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
        : { pendingActionPlans: [...this.snapshot.pendingActionPlans] })
    };
  }

  writeRefresh(input: {
    readonly watchedSubjects: readonly StewardSubject[];
    readonly latestFindings: readonly StewardFinding[];
    readonly latestDecisions: readonly StewardDecision[];
    readonly pendingActionPlans: readonly StewardActionPlan[];
  }): void {
    this.revision += 1;
    this.snapshot = {
      runtimeId: this.runtimeId,
      revision: this.revision,
      watchedSubjects: [...input.watchedSubjects],
      latestFindings: [...input.latestFindings],
      latestDecisions: [...input.latestDecisions],
      pendingActionPlans: [...input.pendingActionPlans],
      updatedAtMs: Date.now()
    };
  }

  setLastError(error: StewardRuntimeLastError | undefined): void {
    if (error === undefined) {
      if (this.snapshot.lastError === undefined) {
        return;
      }

      this.revision += 1;
      const { lastError: _removed, ...rest } = this.snapshot;
      this.snapshot = {
        ...rest,
        revision: this.revision,
        updatedAtMs: Date.now()
      };
      return;
    }

    this.revision += 1;
    this.snapshot = {
      ...this.snapshot,
      revision: this.revision,
      lastError: error.details ?? error.message,
      updatedAtMs: Date.now()
    };
  }
}
