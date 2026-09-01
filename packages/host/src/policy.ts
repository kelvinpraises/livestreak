import { Schema } from "effect";
import { HostOutputMode } from "./descriptor.js";

// --- exports ---

export const HostCacheReceiptsPolicy = Schema.Literal("none", "optional", "required");

export type HostCacheReceiptsPolicy = Schema.Schema.Type<typeof HostCacheReceiptsPolicy>;

export const HostCachePolicy = Schema.Struct({
  available: Schema.Boolean,
  quotaRemainingBytes: Schema.NonNegativeInt,
  retentionDays: Schema.NonNegativeInt,
  receipts: HostCacheReceiptsPolicy
});

export type HostCachePolicy = Schema.Schema.Type<typeof HostCachePolicy>;

export const HostLivePolicy = Schema.Struct({
  minDurationSeconds: Schema.NonNegativeInt,
  maxDurationSeconds: Schema.NonNegativeInt
});

export type HostLivePolicy = Schema.Schema.Type<typeof HostLivePolicy>;

export const HostPolicyEvaluationStatus = Schema.Literal("pass", "warning", "blocked", "unknown");

export type HostPolicyEvaluationStatus = Schema.Schema.Type<typeof HostPolicyEvaluationStatus>;

export const HostPolicyEvaluation = Schema.Struct({
  ruleSet: Schema.Union(Schema.NonEmptyString, Schema.Null),
  status: HostPolicyEvaluationStatus,
  warnings: Schema.Array(Schema.String)
});

export type HostPolicyEvaluation = Schema.Schema.Type<typeof HostPolicyEvaluation>;

export const HostPolicyDescriptor = Schema.Struct({
  hostId: Schema.NonEmptyString,
  accountTier: Schema.NonEmptyString,
  supportedOutputs: Schema.Array(HostOutputMode),
  debug: Schema.Boolean,
  cache: HostCachePolicy,
  live: HostLivePolicy,
  evaluation: HostPolicyEvaluation
});

export type HostPolicyDescriptor = Schema.Schema.Type<typeof HostPolicyDescriptor>;

export const HostCacheIntent = Schema.Literal("none", "optional", "required");

export type HostCacheIntent = Schema.Schema.Type<typeof HostCacheIntent>;

export const HostPolicyBlockReason = Schema.Literal(
  "unsupported_output",
  "endpoint_manifests_unavailable",
  "host_cache_unavailable",
  "cache_receipts_unavailable",
  "live_forwarding_unavailable",
  "cache_quota_exceeded",
  "live_duration_out_of_range"
);

export type HostPolicyBlockReason = Schema.Schema.Type<typeof HostPolicyBlockReason>;

export const HostPolicyRequest = Schema.Struct({
  outputMode: Schema.Union(HostOutputMode, Schema.NonEmptyString),
  debug: Schema.Boolean,
  contentId: Schema.NonEmptyString,
  observer: Schema.NonEmptyString,
  sessionId: Schema.optional(Schema.NonEmptyString),
  expectedDurationSeconds: Schema.optional(Schema.NonNegativeInt),
  expectedCacheBytes: Schema.optional(Schema.NonNegativeInt),
  cacheIntent: Schema.optional(HostCacheIntent)
});

export type HostPolicyRequest = Schema.Schema.Type<typeof HostPolicyRequest>;

export const HostProviderConstraint = Schema.Struct({
  id: Schema.NonEmptyString,
  summary: Schema.NonEmptyString,
  appliesTo: Schema.Array(Schema.NonEmptyString),
  details: Schema.optional(Schema.NonEmptyString)
});

export type HostProviderConstraint = Schema.Schema.Type<typeof HostProviderConstraint>;

export const HostCacheDecision = Schema.Struct({
  intent: HostCacheIntent,
  required: Schema.Boolean,
  maySkip: Schema.Boolean,
  available: Schema.Boolean,
  expectedBytes: Schema.NonNegativeInt,
  quotaRemainingBytes: Schema.NonNegativeInt
});

export type HostCacheDecision = Schema.Schema.Type<typeof HostCacheDecision>;

export const HostLiveDecision = Schema.Struct({
  required: Schema.Boolean,
  available: Schema.Boolean,
  expectedDurationSeconds: Schema.NonNegativeInt
});

export type HostLiveDecision = Schema.Schema.Type<typeof HostLiveDecision>;

export const HostPolicyResult = Schema.Struct({
  descriptor: HostPolicyDescriptor,
  outputMode: Schema.Union(HostOutputMode, Schema.NonEmptyString),
  cache: HostCacheDecision,
  live: HostLiveDecision,
  blockReasons: Schema.Array(HostPolicyBlockReason),
  constraints: Schema.Array(HostProviderConstraint)
});

export type HostPolicyResult = Schema.Schema.Type<typeof HostPolicyResult>;
