export type {
  EvmAddress,
  MarketFailurePhase,
  MarketLifecycleFailed,
  MarketLifecycleNone,
  MarketLifecyclePending,
  MarketLifecycleRegistered,
  MarketLifecycleState,
  MarketLifecycleStatus,
  MarketRegisterInput,
  MarketRegisterResult,
  MarketRegistrar,
  ObserveRunMarketConfig,
  ObserveRunMarketOptions,
  StreamId
} from "./types.js";

export { observeRunStreamId } from "./chains/evm.js";
export { applyMarketLifecycleToBoard } from "./board.js";
export {
  forkMarketRegistrationIfNeeded,
  resolveMarketRegistrarFromOptions,
  runMarketRegistrationLifecycle
} from "./registration.js";
export type { MarketRegistrationForkInput } from "./registration.js";
export {
  validateMarketRunId,
  validateObserveRunMarketConfig,
  validateObserveRunMarketOptions
} from "./validate.js";
export { createMarketRegistrar } from "./chains/index.js";
