import { describe, expect, it } from "vitest";
import { createLocalContentStore } from "#services/walrus/content/local-store.js";
import {
  handleVodMetadataResolve,
  handleVodMetadataStore
} from "#services/walrus/content/vod.js";

describe("local VOD metadata", () => {
  const store = createLocalContentStore({ baseUrl: "http://127.0.0.1:8787" });

  it("stores metadata as a content blob and resolves it back through the host", async () => {
    const stored = await handleVodMetadataStore(
      {
        title: "AI Panel VOD",
        category: "Tech",
        poster: "http://127.0.0.1:8787/content/blobs/ipfs/poster",
        feed: { kind: "file", pointer: "demo.mp4" },
        durationSec: 120
      },
      { store }
    );
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;

    // Pointer uses the local content-addressed scheme — recordable on-chain as-is.
    expect(stored.result.scheme).toBe("ipfs");
    expect(stored.result.url).toContain("/content/blobs/ipfs/");

    const resolved = await handleVodMetadataResolve(
      stored.result.scheme,
      stored.result.id,
      { store }
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.result).toEqual({
      title: "AI Panel VOD",
      category: "Tech",
      poster: "http://127.0.0.1:8787/content/blobs/ipfs/poster",
      feed: { kind: "file", pointer: "demo.mp4" },
      durationSec: 120
    });
  });

  it("rejects malformed metadata and missing blobs", async () => {
    const bad = await handleVodMetadataStore({ title: "x" }, { store });
    expect(bad.ok).toBe(false);

    const missing = await handleVodMetadataResolve("ipfs", "deadbeef", { store });
    expect(missing.ok).toBe(false);
  });
});
