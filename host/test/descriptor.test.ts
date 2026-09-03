import { describe, expect, it } from "vitest";
import { handleDescriptor } from "#services/descriptor.js";
import { defaultHostServerConfig } from "#config/host.js";
import { walrusNetworkProfiles } from "#infrastructure/walrus/network.js";

describe("host descriptor", () => {
  it("advertises module tokens and walrus capabilities without internal ids", () => {
    const config = {
      ...defaultHostServerConfig(),
      walrusNetwork: "mainnet" as const,
      livekitApiKey: undefined
    };

    const descriptor = handleDescriptor({ config });

    expect(descriptor.modules).toEqual(
      expect.arrayContaining(["aa", "media", "walrus_memory", "walrus_content", "discovery"])
    );
    expect(descriptor.media.simulcastAvailable).toBe(false);
    expect(descriptor.supportedOutputs).not.toContain("simulcast");
    expect(descriptor.walrus).toEqual({ network: "mainnet" });
    expect(descriptor.memory).toEqual({
      relayerUrl: walrusNetworkProfiles.mainnet.memory.relayerUrl,
      namespaceTemplate: "market:{marketId}",
      trustModel: "plaintext-relayer"
    });
    expect(descriptor.content).toEqual({
      publisherUrl: walrusNetworkProfiles.mainnet.blob.publisherUrl,
      aggregatorUrl: walrusNetworkProfiles.mainnet.blob.aggregatorUrl
    });
    expect(JSON.stringify(descriptor)).not.toContain("accountId");
    expect(JSON.stringify(descriptor)).not.toContain("memWalAccountId");
    expect(JSON.stringify(descriptor)).not.toContain("OWNER_KEY");
    expect(JSON.stringify(descriptor)).not.toContain("OWNER_SEED");
  });

  it("advertises null walrus when network selector is absent", () => {
    const config = {
      ...defaultHostServerConfig(),
      walrusNetwork: null,
      livekitApiKey: undefined
    };

    const descriptor = handleDescriptor({ config });

    expect(descriptor.walrus).toEqual({ network: null });
    expect(descriptor.memory.relayerUrl).toBeNull();
    expect(descriptor.content.publisherUrl).toBeNull();
    expect(descriptor.content.aggregatorUrl).toBeNull();
  });

  it("advertises simulcast when LiveKit is configured", () => {
    const config = {
      ...defaultHostServerConfig(),
      livekitApiKey: "lk_test_key"
    };

    const descriptor = handleDescriptor({ config });

    expect(descriptor.media.simulcastAvailable).toBe(true);
    expect(descriptor.supportedOutputs).toContain("simulcast");
  });
});
