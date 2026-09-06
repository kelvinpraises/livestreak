import { describe, expect, it, vi } from "vitest";
import type { HostServerConfig } from "#config/host.js";
import {
  WalrusNetworkMismatchError,
  resolveWalrus,
  walrusNetworkProfiles
} from "#infrastructure/walrus/network.js";

const baseConfig = (): HostServerConfig => ({
  hostId: "host_dev",
  baseUrl: "http://127.0.0.1:8787",
  bindHost: "127.0.0.1",
  bindPort: 8787,
  startedAtMs: 0,
  accountTier: "dev",
  enabledModules: ["walrus_memory", "walrus_content"],
  supportedOutputs: ["local"],
  cacheQuotaBytes: 1_000,
  cacheRetentionDays: 7,
  cacheReceipts: "required",
  minDurationSeconds: 0,
  maxDurationSeconds: 3600,
  walrusNetwork: "testnet",
  walrusMemoryRelayerUrlOverride: null,
  walrusRegistryIdOverride: null,
  memorySuiOwnerPrivateKey: "suiprivkey1qqtest",
  memoryOwnerSeed: null,
  walletSeed: null,
  memoryTrustModel: "plaintext-relayer",
  walrusContentEphemeralEpochs: 1,
  walrusContentLockedEpochs: 5,
  resolvedWalrus: null,
  livekitApiKey: undefined,
  remoteAppOrigin: null,
  remoteGatewayToken: null,
  remoteGrantKeyHex: null,
  remoteSessionTtlMs: 3_600_000
});

const mockFetch = (network: "mainnet" | "testnet") =>
  vi.fn(async () => ({
    ok: true,
    json: async () => ({
      packageId: "0xpackage",
      network,
      suiRpcUrl:
        network === "mainnet"
          ? "https://fullnode.mainnet.sui.io:443"
          : "https://fullnode.testnet.sui.io:443"
    })
  })) as unknown as typeof fetch;

describe("resolveWalrus", () => {
  it("resolves memory and blob endpoints for the selected network", async () => {
    const resolved = await resolveWalrus(baseConfig(), mockFetch("testnet"));

    expect(resolved.network).toBe("testnet");
    expect(resolved.memory.relayerUrl).toBe(
      walrusNetworkProfiles.testnet.memory.relayerUrl
    );
    expect(resolved.blob).toEqual(walrusNetworkProfiles.testnet.blob);
    expect(resolved.sui).toEqual({
      rpcUrl: "https://fullnode.testnet.sui.io:443",
      packageId: "0xpackage",
      registryId: walrusNetworkProfiles.testnet.memory.registryId
    });
  });

  it("throws memory_network_mismatch when selector disagrees with relayer /config", async () => {
    await expect(resolveWalrus(baseConfig(), mockFetch("mainnet"))).rejects.toBeInstanceOf(
      WalrusNetworkMismatchError
    );
  });

  it("throws memory_network_mismatch for relayer-url override whose /config disagrees", async () => {
    const config = {
      ...baseConfig(),
      walrusMemoryRelayerUrlOverride: "https://override.example"
    };

    await expect(resolveWalrus(config, mockFetch("mainnet"))).rejects.toBeInstanceOf(
      WalrusNetworkMismatchError
    );
  });
});
