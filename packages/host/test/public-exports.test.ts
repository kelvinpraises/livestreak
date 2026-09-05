import { describe, expect, it } from "vitest";
import * as Public from "#index.js";

const publicExport = (name: string): unknown => (Public as Record<string, unknown>)[name];

describe("host public exports", () => {
  it("exposes descriptor, policy, session, manifest, cache, aa, discovery, and memory shapes", () => {
    expect(publicExport("HostProviderDescriptor")).toBeDefined();
    expect(publicExport("HostModuleToken")).toBeDefined();
    expect(publicExport("OutputMode")).toBeDefined();
    expect(publicExport("HostPolicyRequest")).toBeDefined();
    expect(publicExport("HostPolicyResult")).toBeDefined();
    expect(publicExport("HostPolicyBlockReason")).toBeDefined();
    expect(publicExport("HostCreateSessionRequest")).toBeDefined();
    expect(publicExport("HostSessionResult")).toBeDefined();
    expect(publicExport("EndpointManifest")).toBeDefined();
    expect(publicExport("EndpointKind")).toBeDefined();
    expect(publicExport("HostCacheReceipt")).toBeDefined();
    expect(publicExport("HostCacheReceiptRequest")).toBeDefined();
    expect(publicExport("AaCapabilityDescriptor")).toBeDefined();
    expect(publicExport("SuiSponsorshipDescriptor")).toBeDefined();
    expect(publicExport("SuiSponsorRequest")).toBeDefined();
    expect(publicExport("SuiSponsorResponse")).toBeDefined();
    expect(publicExport("MemoryAccessRequest")).toBeDefined();
    expect(publicExport("MemoryAccessResponse")).toBeDefined();
    expect(publicExport("MarketMemoryBinding")).toBeDefined();
    expect(publicExport("HostSimilarityRequest")).toBeDefined();
    expect(publicExport("HostSimilarityResult")).toBeDefined();
    expect(publicExport("HostSimilarVaultCandidate")).toBeDefined();
    expect(publicExport("HostSimilarityIndexRequest")).toBeDefined();
    expect(publicExport("decodeHostPolicyRequest")).toBeTypeOf("function");
    expect(publicExport("decodeHostDiscoveryRequest")).toBeTypeOf("function");
    expect(publicExport("decodeHostDiscoveryIndexRequest")).toBeTypeOf("function");
    expect(publicExport("decodeMemoryAccessRequest")).toBeTypeOf("function");
    expect(publicExport("validationErrorMessage")).toBeTypeOf("function");
  });

  it("does not expose server or client implementation symbols", () => {
    expect(publicExport("createHttpHostProviderClient")).toBeUndefined();
    expect(publicExport("dispatchRequest")).toBeUndefined();
    expect(publicExport("makeInMemoryHostProviderClient")).toBeUndefined();
    expect(publicExport("HostCapability")).toBeUndefined();
    expect(publicExport("ForumThreadRecord")).toBeUndefined();
    expect(publicExport("decodeHostSimilarityRequest")).toBeUndefined();
  });
});
