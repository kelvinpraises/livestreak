import { describe, expect, it, vi } from "vitest";
import { createMemoryBindingStore } from "#services/walrus/memory/binding.js";
import type { MemWalAccountOperations } from "#services/walrus/memory/memwal-ops.js";
import type { ResolvedWalrus } from "#infrastructure/walrus/network.js";

const testResolved = (): ResolvedWalrus => ({
  network: "mainnet",
  sui: {
    rpcUrl: "https://fullnode.mainnet.sui.io:443",
    packageId: "0xpackage",
    registryId: "0xregistry"
  },
  memory: {
    relayerUrl: "https://relayer.memory.walrus.xyz"
  },
  blob: {
    publisherUrl: "https://publisher.walrus-mainnet.walrus.space",
    aggregatorUrl: "https://aggregator.walrus-mainnet.walrus.space"
  }
});

const createMockOps = (): MemWalAccountOperations => {
  let hostAccountId: string | null = null;

  return {
    createHostAccount: vi.fn(async () => {
      if (hostAccountId === null) {
        hostAccountId = "0xaccount_host";
      }

      return { accountId: hostAccountId };
    }),
    grantDelegate: vi.fn(async ({ delegatePublicKeyHex }) => ({
      suiAddress: `0x${delegatePublicKeyHex.slice(0, 8)}`,
      digest: "digest_test"
    }))
  };
};

describe("memory binding store", () => {
  it("provisions a market binding once and reuses the host account id", async () => {
    const ops = createMockOps();
    const store = createMemoryBindingStore({
      resolved: testResolved(),
      resolveOwnerKey: async () => "suiprivkey1qqtest",
      ops
    });

    const first = await store.provision("mkt_a");
    const second = await store.provision("mkt_a");

    expect(first.memWalAccountId).toBe("0xaccount_host");
    expect(second).toEqual(first);
    expect(ops.createHostAccount).toHaveBeenCalledTimes(1);
  });

  it("grants a delegate and tracks authorization", async () => {
    const ops = createMockOps();
    const store = createMemoryBindingStore({
      resolved: testResolved(),
      resolveOwnerKey: async () => "suiprivkey1qqtest",
      ops
    });
    const delegate = "a".repeat(64);

    await store.grantDelegate("mkt_a", delegate);

    const binding = await store.provision("mkt_a");
    expect(store.hasDelegate(binding.memWalAccountId, delegate)).toBe(true);
    expect(ops.grantDelegate).toHaveBeenCalledTimes(1);

    await store.grantDelegate("mkt_a", delegate);
    expect(ops.grantDelegate).toHaveBeenCalledTimes(1);
  });

  it("does not mark an unknown delegate as granted", async () => {
    const store = createMemoryBindingStore({
      resolved: testResolved(),
      resolveOwnerKey: async () => "suiprivkey1qqtest",
      ops: createMockOps()
    });
    const binding = await store.provision("mkt_a");

    expect(store.hasDelegate(binding.memWalAccountId, "b".repeat(64))).toBe(false);
  });
});
