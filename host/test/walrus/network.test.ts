import { describe, expect, it } from "vitest";
import type { HostServerConfig } from "#config/host.js";
import { resolveWalrus, walrusNetworkProfiles } from "#infrastructure/walrus/network.js";

const baseConfig = (): HostServerConfig => ({
  hostId: "host_dev",
  baseUrl: "http://127.0.0.1:8787",
  bindHost: "127.0.0.1",
  bindPort: 8787,
  startedAtMs: 0,
  accountTier: "dev",
  enabledModules: ["memory", "walrus_content"],
  supportedOutputs: ["local"],
  cacheQuotaBytes: 1_000,
  cacheRetentionDays: 7,
  cacheReceipts: "required",
  minDurationSeconds: 0,
  maxDurationSeconds: 3600,
  walrusNetwork: "testnet",
  walletSeed: null,
  walrusContentEphemeralEpochs: 1,
  walrusContentLockedEpochs: 5,
  resolvedWalrus: null,
  livekitApiKey: undefined,
  remoteAppOrigin: null,
  remoteGatewayToken: null,
  remoteGrantKeyHex: null,
  remoteSessionTtlMs: 3_600_000
});

describe("walrus network resolution", () => {
  it("resolves blob endpoints from the static profile (no relayer round-trip)", () => {
    const resolved = resolveWalrus(baseConfig());

    expect(resolved.network).toBe("testnet");
    expect(resolved.blob).toEqual(walrusNetworkProfiles.testnet.blob);
  });

  it("throws when no walrus network is selected", () => {
    expect(() => resolveWalrus({ ...baseConfig(), walrusNetwork: null })).toThrow(
      "walrus_network_not_selected"
    );
  });
});
