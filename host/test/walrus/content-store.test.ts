import { describe, expect, it, vi } from "vitest";
import { createContentStore } from "#services/walrus/content/content.js";
import type { WalrusClient } from "#infrastructure/walrus/blob-client.js";
import type { ResolvedWalrus } from "#infrastructure/walrus/network.js";

const testResolved = (): ResolvedWalrus => ({
  network: "testnet",
  sui: {
    rpcUrl: "https://fullnode.testnet.sui.io:443",
    packageId: "0xpackage",
    registryId: "0xregistry"
  },
  memory: {
    relayerUrl: "https://relayer-staging.memory.walrus.xyz"
  },
  blob: {
    publisherUrl: "https://publisher.walrus-testnet.walrus.space",
    aggregatorUrl: "https://aggregator.walrus-testnet.walrus.space"
  }
});

describe("content store", () => {
  it("stores bytes and returns a walrus StorePointer", async () => {
    const bytes = new TextEncoder().encode("hello walrus");
    const client: WalrusClient = {
      putBlob: vi.fn(async () => ({ blobId: "blob_test_id" })),
      getBlob: vi.fn(async () => bytes)
    };

    const store = createContentStore({
      resolved: testResolved(),
      ephemeralEpochs: 1,
      lockedEpochs: 5,
      client
    });

    const pointer = await store.store(bytes, "text/plain", { persistence: "ephemeral" });

    expect(pointer).toEqual({
      scheme: "walrus-testnet",
      id: "blob_test_id",
      url: "https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob_test_id"
    });
    expect(client.putBlob).toHaveBeenCalledWith(bytes, 1);
  });

  it("resolves a stored pointer back to bytes", async () => {
    const bytes = new TextEncoder().encode("round trip");
    const client: WalrusClient = {
      putBlob: vi.fn(),
      getBlob: vi.fn(async () => bytes)
    };

    const store = createContentStore({
      resolved: testResolved(),
      ephemeralEpochs: 1,
      lockedEpochs: 5,
      client
    });

    const resolved = await store.resolve("walrus-testnet", "blob_test_id");
    expect(resolved).toEqual(bytes);
  });

  it("rejects empty bytes", async () => {
    const store = createContentStore({
      resolved: testResolved(),
      ephemeralEpochs: 1,
      lockedEpochs: 5,
      client: {
        putBlob: vi.fn(),
        getBlob: vi.fn()
      }
    });

    await expect(
      store.store(new Uint8Array(), undefined, { persistence: "ephemeral" })
    ).rejects.toThrow("content_bytes_empty");
  });
});
