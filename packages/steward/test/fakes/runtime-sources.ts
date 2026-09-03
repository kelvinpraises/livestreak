import type { StewardActionPlan } from "../../src/model/action-plan.js";
import type { StewardDecision } from "../../src/model/decision.js";
import type { StewardFinding } from "../../src/model/finding.js";
import type { StewardSubject } from "../../src/model/subject.js";
import type {
  ContractFactSource,
  HostFactSource,
  MemoryFactSource,
  ObserveFactSource
} from "../../src/runtime/sources.js";
import type {
  StewardActionPlanSink,
  StewardMemoryRememberInput,
  StewardMemorySink
} from "../../src/runtime/sink.js";

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

export const makeFakeMemoryFactSource = (
  factsBySubjectId: Readonly<Record<string, readonly unknown[]>>
): MemoryFactSource => ({
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

export const makeRecordingMemorySink = (): StewardMemorySink & {
  readonly remembered: StewardMemoryRememberInput[];
} => {
  const remembered: StewardMemoryRememberInput[] = [];

  return {
    remembered,
    remember: (input: StewardMemoryRememberInput) => {
      remembered.push(input);
    }
  };
};

export const emptyMemoryPorts = () => ({
  memoryFactSource: makeFakeMemoryFactSource({}),
  memorySink: makeRecordingMemorySink()
});

export type RecordedMemorySink = ReturnType<typeof makeRecordingMemorySink>;

export type RecordedFinding = StewardFinding;
export type RecordedDecision = StewardDecision;
