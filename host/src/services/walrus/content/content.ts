import {
  pointerSchemeForNetwork,
  type ContentPersistence,
  type PointerScheme,
  type StorePointer
} from "@livestreak/host";
import type { ResolvedWalrus } from "../../../infrastructure/walrus/network.js";
import { createWalrusClient, type WalrusClient } from "../../../infrastructure/walrus/blob-client.js";

// --- exports ---

export interface ContentStoreConfig {
  readonly resolved: ResolvedWalrus;
  readonly ephemeralEpochs: number;
  readonly lockedEpochs: number;
  readonly client?: WalrusClient;
}

export interface ContentStore {
  readonly store: (
    bytes: Uint8Array,
    contentType: string | undefined,
    options: { readonly persistence: ContentPersistence }
  ) => Promise<StorePointer>;
  readonly resolve: (scheme: PointerScheme, id: string) => Promise<Uint8Array>;
}

export const createContentStore = (config: ContentStoreConfig): ContentStore => {
  const client =
    config.client ?? createWalrusClient(config.resolved.blob);

  return {
    async store(bytes, _contentType, options) {
      if (bytes.length === 0) {
        throw new Error("content_bytes_empty");
      }

      const epochs =
        options.persistence === "locked" ? config.lockedEpochs : config.ephemeralEpochs;
      const { blobId } = await client.putBlob(bytes, epochs);
      const scheme = pointerSchemeForNetwork(config.resolved.network);
      const aggregatorBase = config.resolved.blob.aggregatorUrl.replace(/\/$/u, "");

      return {
        scheme,
        id: blobId,
        url: `${aggregatorBase}/v1/blobs/${encodeURIComponent(blobId)}`
      };
    },

    async resolve(scheme, id) {
      if (!isWalrusScheme(scheme)) {
        throw new Error(`unsupported_pointer_scheme:${scheme}`);
      }

      const expectedScheme = pointerSchemeForNetwork(config.resolved.network);
      if (scheme !== expectedScheme) {
        throw new Error(`pointer_scheme_mismatch:${scheme}`);
      }

      return client.getBlob(id);
    }
  };
};

// --- helpers ---

const isWalrusScheme = (scheme: PointerScheme): boolean =>
  scheme === "walrus-testnet" || scheme === "walrus-mainnet";
