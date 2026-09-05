// --- exports ---

export type {
  BookmakerDetectionEvaluation,
  BookmakerDetectionInput,
  BookmakerDetectionPolicy,
  PatternDetectionInput,
  PatternDetector
} from "./detection/index.js";
export { detectOpportunity } from "./detection/index.js";
export type { BuildVaultDraftOptions } from "./draft/index.js";
export { buildVaultDraft } from "./draft/index.js";
export type {
  BookmakerSimilarityClient,
  HostSimilarityDuplicateRisk,
  HostSimilarityRequest,
  HostSimilarityResult,
  HostSimilaritySuggestedAction,
  HostSimilarityVaultDraft,
  HostSimilarVaultCandidate
} from "./similarity/index.js";
export {
  findSimilar,
  hostSimilarityResultToBookmaker,
  similarityQueryToHostRequest,
  vaultDraftToHostSimilarityDraft,
  createHostDiscoveryClient,
  DISCOVERY_FIND_PATH
} from "./similarity/index.js";
export type { BookmakerDuplicatePolicy, BookmakerVaultPolicy } from "./decision/index.js";
export { chooseVaultAction } from "./decision/index.js";
export type {
  ObservationEvent,
  ObservationFeed,
  ObservationSnapshot,
  ObservationSubscriptionInput
} from "./observation/index.js";
export { buildObservationSubscriptionInput, validateObservationEvent } from "./observation/index.js";
