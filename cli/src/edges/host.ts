import type {
  ContentPersistence,
  HostProviderDescriptor,
  StorePointer
} from "@livestreak/host";

export interface HostClient {
  readonly baseUrl: string;
  getDescriptor(): Promise<HostProviderDescriptor>;
  health(): Promise<{ ok: boolean }>;
  uploadBlob(
    bytes: Uint8Array,
    contentType: string,
    persistence: ContentPersistence
  ): Promise<StorePointer>;
}

export interface CreateHostClientOptions {
  readonly fetchImpl?: typeof fetch;
}

export const createHostClient = (
  baseUrl: string,
  options: CreateHostClientOptions = {}
): HostClient => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const normalized = baseUrl.replace(/\/$/, "");

  const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetchImpl(`${normalized}${path}`, init);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`host ${path} failed (${response.status}): ${body}`);
    }
    return (await response.json()) as T;
  };

  return {
    baseUrl: normalized,

    getDescriptor: () => requestJson<HostProviderDescriptor>("/descriptor"),

    health: async () => {
      const result = await requestJson<{ status?: string }>("/health");
      return { ok: result.status === "ok" || result.status === undefined };
    },

    uploadBlob: async (bytes, contentType, persistence) => {
      const body = {
        bytesBase64: Buffer.from(bytes).toString("base64"),
        contentType,
        persistence
      };

      return requestJson<StorePointer>("/content/blobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
    }
  };
};
