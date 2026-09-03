import type { ResolvedWalrus } from "./network.js";

// --- exports ---

export interface WalrusBlobEndpoints {
  readonly publisherUrl: string;
  readonly aggregatorUrl: string;
}

export interface WalrusPutBlobResult {
  readonly blobId: string;
}

export interface WalrusClient {
  readonly putBlob: (
    bytes: Uint8Array,
    epochs: number
  ) => Promise<WalrusPutBlobResult>;
  readonly getBlob: (blobId: string) => Promise<Uint8Array>;
}

export const createWalrusClient = (
  endpoints: WalrusBlobEndpoints,
  fetchImpl: typeof fetch = fetch
): WalrusClient => ({
  async putBlob(bytes, epochs) {
    const base = endpoints.publisherUrl.replace(/\/$/u, "");
    const response = await fetchWithRetry(
      `${base}/v1/blobs?epochs=${epochs}`,
      {
        method: "PUT",
        body: Buffer.from(bytes),
        headers: { "content-type": "application/octet-stream" }
      },
      fetchImpl
    );

    if (!response.ok) {
      throw new Error(`Walrus publisher PUT failed (${response.status})`);
    }

    const body = (await response.json()) as {
      newlyCreated?: { blobObject?: { blobId?: string } };
      alreadyCertified?: { blobId?: string };
    };

    const blobId =
      body.newlyCreated?.blobObject?.blobId ?? body.alreadyCertified?.blobId;

    if (blobId === undefined || blobId.length === 0) {
      throw new Error("Walrus publisher response missing blobId");
    }

    return { blobId };
  },

  async getBlob(blobId) {
    const base = endpoints.aggregatorUrl.replace(/\/$/u, "");
    const response = await fetchWithRetry(
      `${base}/v1/blobs/${encodeURIComponent(blobId)}`,
      { method: "GET" },
      fetchImpl
    );

    if (!response.ok) {
      throw new Error(`Walrus aggregator GET failed (${response.status})`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }
});

export const walrusEndpointsFromResolved = (resolved: ResolvedWalrus): WalrusBlobEndpoints =>
  resolved.blob;

// --- helpers ---

const fetchWithRetry = async (
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  maxAttempts = 3
): Promise<Response> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, init);
      if (response.ok || response.status < 500) {
        return response;
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < maxAttempts - 1) {
      await sleep(100 * 2 ** attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Walrus fetch failed");
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
