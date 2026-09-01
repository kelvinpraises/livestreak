import { Schema } from "effect";

// --- exports ---

export const EndpointKind = Schema.Literal(
  "watch",
  "webrtc",
  "state",
  "telemetry",
  "archive",
  "control"
);

export type EndpointKind = Schema.Schema.Type<typeof EndpointKind>;

export const EndpointDescriptor = Schema.Struct({
  kind: EndpointKind,
  url: Schema.NonEmptyString,
  expiresAtMs: Schema.Union(Schema.Number, Schema.Null)
});

export type EndpointDescriptor = Schema.Schema.Type<typeof EndpointDescriptor>;

export const EndpointManifest = Schema.Struct({
  version: Schema.Literal("0.1.0"),
  manifestId: Schema.NonEmptyString,
  sessionId: Schema.NonEmptyString,
  observer: Schema.NonEmptyString,
  contentId: Schema.NonEmptyString,
  hostId: Schema.NonEmptyString,
  endpoints: Schema.Array(EndpointDescriptor),
  hostPolicyStatus: Schema.NonEmptyString,
  cacheReceiptRefs: Schema.Array(Schema.NonEmptyString),
  issuedAtMs: Schema.Number,
  expiresAtMs: Schema.Number,
  signature: Schema.NonEmptyString
});

export type EndpointManifest = Schema.Schema.Type<typeof EndpointManifest>;
