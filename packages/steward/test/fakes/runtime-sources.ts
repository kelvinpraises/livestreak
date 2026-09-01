import type { StewardActionPlan } from "../../src/model/action-plan.js";
import type { StewardSubject } from "../../src/model/subject.js";
import type {
  ContractFactSource,
  HostFactSource,
  ObserveFactSource
} from "../../src/runtime/sources.js";
import type { StewardActionPlanSink } from "../../src/runtime/sink.js";

// --- exports ---

export const makeFakeContractFactSource = (
  factsBySubjectId: Readonly<Record<string, readonly unknown[]>>
): ContractFactSource => ({
  readFacts: async (subject: StewardSubject) => factsBySubjectId[subject.id] ?? []
});

export const makeFakeHostFactSource = (
  factsBySubjectId: Readonly<Record<string, readonly unknown[]>>
): HostFactSource => ({
  readFacts: async (subject: StewardSubject) => factsBySubjectId[subject.id] ?? []
});

export const makeFakeObserveFactSource = (
  factsBySubjectId: Readonly<Record<string, readonly unknown[]>>
): ObserveFactSource => ({
  readFacts: async (subject: StewardSubject) => factsBySubjectId[subject.id] ?? []
});

export const makeRecordingActionPlanSink = (): StewardActionPlanSink & {
  readonly plans: StewardActionPlan[];
} => {
  const plans: StewardActionPlan[] = [];

  return {
    plans,
    submit: (next: readonly StewardActionPlan[]) => {
      plans.push(...next);
    }
  };
};
