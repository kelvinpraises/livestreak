import {
  canonicalResolutionBytes,
  resolutionDigest,
  verifyResolutionRecord,
} from "@livestreak/schema";
export const createResolutionClient = (baseUrl: string, fetcher: typeof fetch = fetch) => {
  const base = baseUrl.replace(/\/$/, "");
  const readJson = async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await fetcher(base + path, {
      ...init,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || !response.body)
      throw new Error(`Resolution record unavailable (HTTP ${response.status})`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 65536) {
          await reader.cancel();
          throw new Error("Resolution response too large");
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  };
  const read = async (digest: string) => {
    if (!/^0x[0-9a-f]{64}$/.test(digest)) throw new Error("Invalid resolution digest");
    return verifyResolutionRecord(await readJson(`/content/resolutions/${digest}`), digest);
  };
  return {
    read,
    async publish(input: unknown) {
      const record = await verifyResolutionRecord(input);
      const digest = await resolutionDigest(record);
      await readJson("/content/resolutions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new TextDecoder().decode(canonicalResolutionBytes(record)),
      });
      await read(digest);
      return digest;
    },
    async list(chainId: string, vaultId: string) {
      const value = await readJson(
        `/content/resolutions?chainId=${encodeURIComponent(chainId)}&vaultId=${encodeURIComponent(vaultId)}`,
      );
      if (
        !Array.isArray(value) ||
        value.length > 20 ||
        value.some((v) => typeof v !== "string" || !/^0x[0-9a-f]{64}$/.test(v))
      )
        throw new Error("Invalid resolution list");
      return value as string[];
    },
  };
};
