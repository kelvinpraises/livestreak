import { Schema } from "effect";

// --- exports ---

export const HostCapability = Schema.Literal(
  "webrtc_forwarding",
  "host_cache",
  "endpoint_manifests",
  "thumbnails",
  "audit_logs",
  "key_rotation"
);

export type HostCapability = Schema.Schema.Type<typeof HostCapability>;

export const HostOutputMode = Schema.Literal("forwarder", "local", "file");

export type HostOutputMode = Schema.Schema.Type<typeof HostOutputMode>;

export const HostProviderDescriptor = Schema.Struct({
  version: Schema.Literal("0.1.0"),
  hostId: Schema.NonEmptyString,
  baseUrl: Schema.NonEmptyString,
  capabilities: Schema.Array(HostCapability),
  supportedOutputs: Schema.Array(HostOutputMode),
  termsVersion: Schema.optional(Schema.NonEmptyString)
});

export type HostProviderDescriptor = Schema.Schema.Type<typeof HostProviderDescriptor>;
