export type { BookmakerSimilarityClient } from "./client.js";
export type {
  HostSimilarityDuplicateRisk,
  HostSimilarityRequest,
  HostSimilarityResult,
  HostSimilaritySuggestedAction,
  HostSimilarityVaultDraft,
  HostSimilarVaultCandidate
} from "@livestreak/host";
export {
  hostSimilarityResultToBookmaker,
  similarityQueryToHostRequest,
  vaultDraftToHostSimilarityDraft
} from "./host-adapter.js";
export { findSimilar } from "./find.js";
