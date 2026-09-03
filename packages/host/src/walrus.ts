import { Schema } from "effect";

// --- exports ---

export const WalrusNetwork = Schema.Literal("mainnet", "testnet");

export type WalrusNetwork = Schema.Schema.Type<typeof WalrusNetwork>;

export const PointerScheme = Schema.Literal(
  "walrus-testnet",
  "walrus-mainnet",
  "ipfs",
  "arweave"
);

export type PointerScheme = Schema.Schema.Type<typeof PointerScheme>;

export const StorePointer = Schema.Struct({
  scheme: PointerScheme,
  id: Schema.NonEmptyString,
  url: Schema.NonEmptyString
});

export type StorePointer = Schema.Schema.Type<typeof StorePointer>;

export const ContentPersistence = Schema.Literal("ephemeral", "locked");

export type ContentPersistence = Schema.Schema.Type<typeof ContentPersistence>;

export const ContentBlobStoreRequest = Schema.Struct({
  bytesBase64: Schema.NonEmptyString,
  contentType: Schema.optional(Schema.NonEmptyString),
  persistence: Schema.optional(ContentPersistence)
});

export type ContentBlobStoreRequest = Schema.Schema.Type<typeof ContentBlobStoreRequest>;

export const WalrusDescriptorAdvert = Schema.Struct({
  network: Schema.Union(WalrusNetwork, Schema.Null)
});

export type WalrusDescriptorAdvert = Schema.Schema.Type<typeof WalrusDescriptorAdvert>;

export const ContentDescriptorAdvert = Schema.Struct({
  publisherUrl: Schema.Union(Schema.Null, Schema.NonEmptyString),
  aggregatorUrl: Schema.Union(Schema.Null, Schema.NonEmptyString)
});

export type ContentDescriptorAdvert = Schema.Schema.Type<typeof ContentDescriptorAdvert>;

export const pointerSchemeForNetwork = (network: WalrusNetwork): PointerScheme =>
  network === "testnet" ? "walrus-testnet" : "walrus-mainnet";
