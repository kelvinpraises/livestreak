import { Schema } from "effect";

// Legacy scheme labels remain decode-only for existing chain state; no legacy storage provider is shipped.
export const PointerScheme = Schema.Literal(
  "walrus-testnet",
  "walrus-mainnet",
  "ipfs",
  "arweave",
  "host",
);
export type PointerScheme = Schema.Schema.Type<typeof PointerScheme>;
export const StorePointer = Schema.Struct({
  scheme: PointerScheme,
  id: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
});
export type StorePointer = Schema.Schema.Type<typeof StorePointer>;
export const ContentPersistence = Schema.Literal("ephemeral", "locked");
export type ContentPersistence = Schema.Schema.Type<typeof ContentPersistence>;
export const ContentBlobStoreRequest = Schema.Struct({
  bytesBase64: Schema.NonEmptyString,
  contentType: Schema.optional(Schema.NonEmptyString),
  persistence: Schema.optional(ContentPersistence),
});
export type ContentBlobStoreRequest = Schema.Schema.Type<typeof ContentBlobStoreRequest>;
export const ContentDescriptorAdvert = Schema.Struct({
  available: Schema.Boolean,
  apiUrl: Schema.String,
  recordingsAvailable: Schema.Boolean,
});
export type ContentDescriptorAdvert = Schema.Schema.Type<typeof ContentDescriptorAdvert>;

export interface RecordingScope {
  readonly chain: "evm" | "solana" | "sui";
  readonly marketId: string;
  readonly runId: string;
}
export interface RecordingReceipt extends RecordingScope {
  readonly status: "recording" | "processing" | "ready" | "failed";
  readonly id: string;
  readonly segments: number;
  readonly bytes: number;
  readonly durationSeconds: number;
  readonly error?: string;
  readonly pointer?: StorePointer;
}

/** All provider credentials stay on Host. This client uses only a Host-issued access credential. */
export const createHostRecordingClient = (
  baseUrl: string,
  accessToken?: string,
  fetchImpl: typeof fetch = fetch,
) => {
  const base = baseUrl.replace(/\/$/, "");
  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetchImpl(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Host recording request failed (${response.status})`);
    return response.json() as Promise<T>;
  };
  return {
    begin: (scope: RecordingScope) =>
      call<RecordingReceipt & { ingestToken: string }>("/recordings", scope),
    read: (scope: RecordingScope) =>
      call<RecordingReceipt>(
        `/recordings/by-market/${scope.chain}/${encodeURIComponent(scope.marketId)}?runId=${encodeURIComponent(scope.runId)}`,
      ),
    retry: (id: string) =>
      call<RecordingReceipt>(`/recordings/${encodeURIComponent(id)}/retry`, {}),
  };
};
