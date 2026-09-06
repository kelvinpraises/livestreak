import { Schema } from "effect";

// --- exports ---

export const HostSimilarityVaultDraft = Schema.Struct({
  title: Schema.NonEmptyString,
  summary: Schema.NonEmptyString,
  tags: Schema.Array(Schema.String)
});

export type HostSimilarityVaultDraft = Schema.Schema.Type<typeof HostSimilarityVaultDraft>;

export const HostSimilaritySuggestedAction = Schema.Literal(
  "join-existing",
  "create-new",
  "skip"
);

export type HostSimilaritySuggestedAction = Schema.Schema.Type<typeof HostSimilaritySuggestedAction>;

export const HostSimilarVaultCandidate = Schema.Struct({
  kind: Schema.Literal("vault"),
  vaultId: Schema.NonEmptyString,
  // Bookmaker dedup keys off `vaultKey` (choose.ts). Optional so older indexes
  // still decode; the host echoes it when the index request carried it.
  vaultKey: Schema.optional(Schema.NonEmptyString),
  marketId: Schema.NonEmptyString,
  score: Schema.Number,
  reason: Schema.NonEmptyString,
  suggestedAction: HostSimilaritySuggestedAction
});

export type HostSimilarVaultCandidate = Schema.Schema.Type<typeof HostSimilarVaultCandidate>;

export const HostSimilarityDuplicateRisk = Schema.Literal("low", "medium", "high");

export type HostSimilarityDuplicateRisk = Schema.Schema.Type<typeof HostSimilarityDuplicateRisk>;

export const HostSimilarityRequest = Schema.Struct({
  marketId: Schema.NonEmptyString,
  vaultDraft: HostSimilarityVaultDraft
});

export type HostSimilarityRequest = Schema.Schema.Type<typeof HostSimilarityRequest>;

export const HostSimilarityResult = Schema.Struct({
  marketId: Schema.NonEmptyString,
  candidates: Schema.Array(HostSimilarVaultCandidate),
  duplicateRisk: Schema.optional(HostSimilarityDuplicateRisk),
  stewardWarnings: Schema.optional(Schema.Array(Schema.String))
});

export type HostSimilarityResult = Schema.Schema.Type<typeof HostSimilarityResult>;

export const HostSimilarityIndexRequest = Schema.Struct({
  vaultId: Schema.NonEmptyString,
  vaultKey: Schema.optional(Schema.NonEmptyString),
  marketId: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  summary: Schema.NonEmptyString,
  tags: Schema.Array(Schema.String)
});

export type HostSimilarityIndexRequest = Schema.Schema.Type<typeof HostSimilarityIndexRequest>;
