// Real injected-port adapters for the steward runtime (WAVE 5 BUILD).
// Each consumes the OWNING package's surface via an injected client and translates domain reads/writes
// into the steward fact/action model — steward owns the translation, not the underlying SDKs.

export { buildStewardFact, type BuildFactInput } from "./fact.js";
export {
  createContractFactSource,
  type ContractVaultReader,
  type ContractVaultFact
} from "./contract-source.js";
export {
  createHostFactSource,
  type HostFactReader,
  type HostSubjectFact
} from "./host-source.js";
export { createObserveFactSource, type ObserveBoardReader } from "./observe-source.js";
export {
  createMemoryFactSource,
  createMemorySink,
  type MemWalMemory,
  type MemoryRecord,
  type MemWalRememberRecord
} from "./memory.js";
export {
  createActionPlanSink,
  type StewardActionExecutor,
  type StewardContractExecutor,
  type StewardHostActionExecutor,
  type DispatchedPlanSummary
} from "./action-plan-sink.js";
