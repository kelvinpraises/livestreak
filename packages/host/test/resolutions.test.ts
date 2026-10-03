import { expect, it, vi } from "vitest";
import { createResolutionClient } from "../src/resolutions.js";
import { fixtureResolution } from "../../schema/test/helpers/resolution.js";
import { resolutionDigest } from "@livestreak/schema";
it("verifies publication readback and fails closed on a tampered record", async () => {
  const r = await fixtureResolution(),
    d = await resolutionDigest(r);
  let tampered = false;
  const fetcher = vi.fn(
    async (_url: unknown, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === "POST"
            ? { digest: d }
            : tampered
              ? { ...r, reason: "tampered" }
              : r,
        ),
        { status: 200 },
      ),
  );
  const c = createResolutionClient("http://host", fetcher as typeof fetch);
  expect(await c.publish(r)).toBe(d);
  tampered = true;
  await expect(c.read(d)).rejects.toThrow("digest mismatch");
});
it("bounds response and record discovery before accepting Host data", async () => {
  const c = createResolutionClient(
    "http://host",
    async () => new Response(" ".repeat(65537)),
  );
  await expect(c.list("eip155:1", "vault")).rejects.toThrow("too large");
});
