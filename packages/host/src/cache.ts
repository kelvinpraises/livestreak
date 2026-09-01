import { Schema } from "effect";

// --- exports ---

export const ProtocolReferenceKind = Schema.Literal(
  "endpoint_manifest",
  "observation",
  "cache_receipt",
  "evidence",
  "proof",
  "vault",
  "transaction"
);

export type ProtocolReferenceKind = Schema.Schema.Type<typeof ProtocolReferenceKind>;

export const ProtocolReference = Schema.Struct({
  kind: ProtocolReferenceKind,
  ref: Schema.NonEmptyString,
  chainId: Schema.optional(Schema.NonNegativeInt),
  version: Schema.optional(Schema.NonEmptyString)
});

export type ProtocolReference = Schema.Schema.Type<typeof ProtocolReference>;

export const HostCacheReceiptStatus = Schema.Literal("accepted", "pending", "rejected");

export type HostCacheReceiptStatus = Schema.Schema.Type<typeof HostCacheReceiptStatus>;

export const HostCacheReceipt = Schema.Struct({
  receiptId: Schema.NonEmptyString,
  hostId: Schema.NonEmptyString,
  sessionId: Schema.NonEmptyString,
  evidence: ProtocolReference,
  status: HostCacheReceiptStatus,
  issuedAtMs: Schema.Number,
  signature: Schema.NonEmptyString
});

export type HostCacheReceipt = Schema.Schema.Type<typeof HostCacheReceipt>;

export const HostCacheReceiptSubmissionStatus = Schema.Literal(
  "accepted",
  "pending",
  "rejected",
  "blocked"
);

export type HostCacheReceiptSubmissionStatus = Schema.Schema.Type<
  typeof HostCacheReceiptSubmissionStatus
>;

export const HostCacheReceiptRequest = Schema.Struct({
  sessionId: Schema.NonEmptyString,
  contentId: Schema.NonEmptyString,
  observer: Schema.NonEmptyString,
  evidence: ProtocolReference,
  bytesStored: Schema.optional(Schema.NonNegativeInt),
  issuedAtMs: Schema.optional(Schema.Number)
});

export type HostCacheReceiptRequest = Schema.Schema.Type<typeof HostCacheReceiptRequest>;

export const HostCacheReceiptSubmission = Schema.Struct({
  status: HostCacheReceiptSubmissionStatus,
  receipt: Schema.Union(HostCacheReceipt, Schema.Null),
  quotaRemainingBytes: Schema.NonNegativeInt,
  reason: Schema.optional(
    Schema.Literal(
      "host_cache_unavailable",
      "cache_receipts_unavailable",
      "cache_quota_exceeded"
    )
  )
});

export type HostCacheReceiptSubmission = Schema.Schema.Type<typeof HostCacheReceiptSubmission>;
