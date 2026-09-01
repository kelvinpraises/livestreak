// --- exports ---

export interface BookmakerWatchSource {
  readonly marketId: string;
  readonly watchUrl?: string;
  readonly webrtcUrl?: string;
  readonly observationEndpoint?: string;
  readonly endpointManifestUri?: string;
  readonly cacheReceiptRefs?: readonly string[];
}
