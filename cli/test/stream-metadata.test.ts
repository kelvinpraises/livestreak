import { describe, expect, it } from "vitest";
import { triggerStreamMetadata } from "../src/adapters/stream.js";
import type { LivestreakInitDoc } from "../src/prefs/init-doc.js";

const doc = { host: { url: "http://localhost:4000" } } as unknown as LivestreakInitDoc;
const marketId = `0x${"ab".repeat(32)}`;

describe("cli stream metadata → host /content/vod (S4)", () => {
  it("POSTs the VOD schema to /content/vod (not /content/metadata)", async () => {
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seenUrl = url;
      seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return { ok: true, status: 201, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    await triggerStreamMetadata(
      doc,
      { marketId, title: "Keynote", category: "tech" },
      fakeFetch
    );

    expect(seenUrl).toBe("http://localhost:4000/content/vod");
    expect(seenBody.title).toBe("Keynote");
    expect(seenBody.category).toBe("tech");
    const feed = seenBody.feed as { kind: string; pointer: string };
    expect(feed.kind).toBe("webrtc");
    expect(feed.pointer).toBe(marketId);
  });

  it("throws on a non-ok host response", async () => {
    const fakeFetch = (async () =>
      ({ ok: false, status: 500, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    await expect(
      triggerStreamMetadata(doc, { marketId, title: "x", category: "y" }, fakeFetch)
    ).rejects.toThrow(/content\/vod/);
  });
});
