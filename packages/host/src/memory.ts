import { Schema } from "effect";

// --- exports ---

export const MemoryTrustModel = Schema.Literal(
  "plaintext-relayer",
  "client-encrypted",
  "tee-attested"
);

export type MemoryTrustModel = Schema.Schema.Type<typeof MemoryTrustModel>;

export const MemoryAccessRequest = Schema.Struct({
  marketId: Schema.NonEmptyString,
  suiDelegate: Schema.NonEmptyString
});

export type MemoryAccessRequest = Schema.Schema.Type<typeof MemoryAccessRequest>;

export const MemoryAccessResponse = Schema.Struct({
  relayerUrl: Schema.NonEmptyString,
  namespace: Schema.NonEmptyString,
  accountId: Schema.NonEmptyString
});

export type MemoryAccessResponse = Schema.Schema.Type<typeof MemoryAccessResponse>;

export const MarketMemoryBinding = Schema.Struct({
  marketId: Schema.NonEmptyString,
  memWalAccountId: Schema.NonEmptyString,
  namespace: Schema.NonEmptyString
});

export type MarketMemoryBinding = Schema.Schema.Type<typeof MarketMemoryBinding>;

export const MemoryDescriptorAdvert = Schema.Struct({
  relayerUrl: Schema.Union(Schema.Null, Schema.NonEmptyString),
  namespaceTemplate: Schema.Literal("market:{marketId}"),
  trustModel: MemoryTrustModel
});

export type MemoryDescriptorAdvert = Schema.Schema.Type<typeof MemoryDescriptorAdvert>;
