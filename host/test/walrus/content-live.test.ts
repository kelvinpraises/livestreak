import { describe, expect, it } from "vitest";
import { createWalrusClient } from "#infrastructure/walrus/blob-client.js";
import { walrusNetworkProfiles } from "#infrastructure/walrus/network.js";

const liveEnabled = process.env.WALRUS_LIVE === "1";

describe.skipIf(!liveEnabled)("content live integration", () => {
  it("round-trips bytes on walrus testnet without a wallet", async () => {
    const endpoints = walrusNetworkProfiles.testnet.blob;
    const client = createWalrusClient(endpoints);
    const payload = new TextEncoder().encode(`flowstream-host-walrus-live-${Date.now()}`);

    const stored = await client.putBlob(payload, 1);
    expect(stored.blobId.length).toBeGreaterThan(0);

    const resolved = await client.getBlob(stored.blobId);
    expect(new TextDecoder().decode(resolved)).toBe(new TextDecoder().decode(payload));
  });
});
