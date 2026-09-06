import { createHash } from "node:crypto";
import type { PointerScheme, StorePointer } from "@livestreak/host";
import type { ContentStore } from "./content.js";

// --- exports ---

export interface LocalContentStoreConfig {
  // Public base URL of this host (e.g. http://127.0.0.1:8787). Used to build a resolvable
  // pointer URL that points back at this host's /content/blobs/:scheme/:id endpoint.
  readonly baseUrl: string;
}

// Dev/local content store used when Walrus is NOT configured (no LIVESTREAK_WALRUS_NETWORK).
// Keeps blobs in-process, content-addressed by sha256, and serves them back through the host's
// own resolve endpoint so the whole produce → publish → resolve loop works on a fully local
// EVM stack with no external storage network. The pointer uses the content-addressed "ipfs"
// scheme (the closest fit in the shared PointerScheme enum) to signal a non-Walrus origin.
export const createLocalContentStore = (config: LocalContentStoreConfig): ContentStore => {
  const blobs = new Map<string, Uint8Array>();
  const scheme: PointerScheme = "ipfs";
  const base = config.baseUrl.replace(/\/$/u, "");

  return {
    async store(bytes, _contentType, _options): Promise<StorePointer> {
      if (bytes.length === 0) {
        throw new Error("content_bytes_empty");
      }

      const id = createHash("sha256").update(bytes).digest("hex");
      blobs.set(id, bytes);

      return {
        scheme,
        id,
        url: `${base}/content/blobs/${scheme}/${encodeURIComponent(id)}`
      };
    },

    async resolve(pointerScheme, id): Promise<Uint8Array> {
      if (pointerScheme !== scheme) {
        throw new Error(`unsupported_pointer_scheme:${pointerScheme}`);
      }

      const bytes = blobs.get(id);
      if (bytes === undefined) {
        throw new Error(`content_not_found:${id}`);
      }

      return bytes;
    }
  };
};
