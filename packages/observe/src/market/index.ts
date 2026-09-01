export type {
  DecodedMarketRegistered,
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
  StreamId,
  VerifiedMarketRegistration
} from "./types.js";

export { testPlaceholderDeriveStreamId } from "./types.js";
export { applyMarketLifecycleToBoard } from "./board.js";
export { verifyMarketRegistration, decodeMarketRegisteredPayload } from "./verify.js";
export type { VerifyMarketRegistrationInput } from "./verify.js";
export {
  forkMarketRegistrationIfNeeded,
  resolveMarketRegistrarFromOptions,
  resetMarketRegistrationRunsForTests,
  runMarketRegistrationLifecycle
} from "./registration.js";
export type { MarketRegistrationForkInput } from "./registration.js";
export { validateObserveRunMarketConfig, validateObserveRunMarketOptions } from "./validate.js";
export { createMarketRegistrar } from "./chains/index.js";
