import { describe, expect, it } from "vitest";
import { createHostDiscoveryClient, DISCOVERY_FIND_PATH } from "../../src/similarity/host-client.js";
import { vaultDraft } from "../helpers/fixtures.js";

describe("createHostDiscoveryClient", () => {
  it("posts to /discovery/find", async () => {
    const urls: string[] = [];
    const client = createHostDiscoveryClient({
      baseUrl: "http://127.0.0.1:3000",
      fetchImpl: async (url) => {
        urls.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            marketId: "market-1",
            candidates: [],
            duplicateRisk: "low"
          })
        } as Response;
      }
    });

    const draft = vaultDraft();
    const result = await client.findSimilar({ marketId: draft.marketId, vaultDraft: draft });

    expect(urls).toEqual([`http://127.0.0.1:3000${DISCOVERY_FIND_PATH}`]);
    expect(result.marketId).toBe("market-1");
  });
});
