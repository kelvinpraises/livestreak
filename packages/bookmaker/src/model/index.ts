// --- exports ---

export type { BookmakerDecision, BookmakerSkipReason } from "./decision.js";
export type { Detection } from "./detection.js";
export type { BookmakerMarketContext } from "./market-context.js";
export type {
  BookmakerWatchRef,
  BookmakerWatchRefKind,
  BookmakerWatchSource
} from "./watch-source.js";
export type { SimilarityCandidate, SimilarityQuery, SimilarityResult } from "./similarity.js";
export type { VaultDraft, VaultResolutionWindow } from "./vault-draft.js";
export type { VaultIdempotencyFields } from "./idempotency.js";
export {
  idempotencyKeyFor,
  idempotencyKeyFromDraft,
  idempotencyKeyFromCreateIntent,
  normalizeVaultQuestion
} from "./idempotency.js";
export type {
  BookmakerWriteIntent,
  CreateVaultIntent,
  JoinVaultIntent
} from "./write-intent.js";
export { buildCreateVaultIntent, buildWriteIntentsFromDecision } from "./write-intent.js";
export type {
  ValidationFailure,
  ValidationResult,
  ValidationSuccess
} from "./validate.js";
export {
  validateBookmakerDecision,
  validateBookmakerMarketContext,
  validateBookmakerWatchSource,
  validateDetection,
  validateSimilarityResult,
  validateVaultDraft,
  validateVaultDraftForCreate,
  validateCreateVaultIntent,
  validateBookmakerWriteIntent,
  validationFailure,
  validationSuccess
} from "./validate.js";
