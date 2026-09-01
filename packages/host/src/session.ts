import { Schema } from "effect";
import { HostOutputMode } from "./descriptor.js";
import { EndpointDescriptor, EndpointManifest } from "./manifest.js";
import { HostCacheIntent, HostPolicyResult } from "./policy.js";

// --- exports ---

export const HostCreateSessionRequest = Schema.Struct({
  outputMode: Schema.Union(HostOutputMode, Schema.NonEmptyString),
  debug: Schema.Boolean,
  contentId: Schema.NonEmptyString,
  observer: Schema.NonEmptyString,
  expectedDurationSeconds: Schema.optional(Schema.NonNegativeInt),
  expectedCacheBytes: Schema.optional(Schema.NonNegativeInt),
  cacheIntent: Schema.optional(HostCacheIntent),
  sessionId: Schema.NonEmptyString,
  allowWarnings: Schema.optional(Schema.Boolean),
  nowMs: Schema.optional(Schema.Number)
});

export type HostCreateSessionRequest = Schema.Schema.Type<typeof HostCreateSessionRequest>;

export const HostSessionStatus = Schema.Literal("draft", "active", "closed");

export type HostSessionStatus = Schema.Schema.Type<typeof HostSessionStatus>;

export const HostSessionSummary = Schema.Struct({
  sessionId: Schema.NonEmptyString,
  hostId: Schema.NonEmptyString,
  observer: Schema.NonEmptyString,
  contentId: Schema.NonEmptyString,
  outputMode: Schema.NonEmptyString,
  status: HostSessionStatus,
  createdAtMs: Schema.Number
});

export type HostSessionSummary = Schema.Schema.Type<typeof HostSessionSummary>;

export const HostSessionDraft = Schema.Struct({
  sessionId: Schema.NonEmptyString,
  endpoints: Schema.Array(EndpointDescriptor),
  manifestDraft: EndpointManifest,
  policy: HostPolicyResult
});

export type HostSessionDraft = Schema.Schema.Type<typeof HostSessionDraft>;

export const HostSessionResult = Schema.Struct({
  summary: HostSessionSummary,
  draft: HostSessionDraft
});

export type HostSessionResult = Schema.Schema.Type<typeof HostSessionResult>;
