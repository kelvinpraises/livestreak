import { describe, expect, it } from "vitest";
import { handleDescriptor } from "#features/descriptor/routes.js";
import { defaultHostServerConfig } from "#config/host.js";

describe("host descriptor", () => {
  it("advertises module tokens and cloud capabilities without internal ids", () => {
    const config = {
      ...defaultHostServerConfig(),
      storage: {endpoint:"https://storage.test",bucket:"media",accessKeyId:"KEY",secretAccessKey:"SECRET",publicBaseUrl:"https://media.test",region:"auto"},
      contentWriteToken: "TOKEN"
    };

    const descriptor = handleDescriptor({ config });

    expect(descriptor.modules).toEqual(
      expect.arrayContaining(["aa", "media", "memory", "content", "discovery"])
    );
    expect(descriptor.media.simulcastAvailable).toBe(false);
    expect(descriptor.supportedOutputs).not.toContain("simulcast");
    expect(descriptor.memory).toEqual({ recordsAvailable: true });
    expect(descriptor.content).toMatchObject({available:true,recordingsAvailable:true});
    expect(JSON.stringify(descriptor)).not.toContain("SECRET");
    expect(JSON.stringify(descriptor)).not.toContain("TOKEN");
    expect(JSON.stringify(descriptor)).not.toContain("accountId");
    expect(JSON.stringify(descriptor)).not.toContain("memWalAccountId");
    expect(JSON.stringify(descriptor)).not.toContain("OWNER_KEY");
    expect(JSON.stringify(descriptor)).not.toContain("OWNER_SEED");
  });

  it("advertises unavailable cloud storage when no provider is configured", () => {
    const config = {
      ...defaultHostServerConfig(),
      storage: null
    };

    const descriptor = handleDescriptor({ config });

    expect(descriptor.memory.recordsAvailable).toBe(true);
    expect(descriptor.content.available).toBe(false);
  });

  it("never advertises an unimplemented simulcast provider", () => {
    const config = { ...defaultHostServerConfig(), supportedOutputs: ['file', 'local', 'simulcast'] as const };
    const descriptor = handleDescriptor({ config });
    expect(descriptor.media.simulcastAvailable).toBe(false);
    expect(descriptor.supportedOutputs).not.toContain('simulcast');
  });
});
