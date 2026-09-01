import { describe, expect, it } from "vitest";
import {
  AaCapabilityDescriptor,
  HostPolicyResult,
  HostProviderDescriptor,
  HostSimilarityResult
} from "#index.js";

describe("host descriptor shape", () => {
  it("accepts a minimal provider descriptor", () => {
    const descriptor: HostProviderDescriptor = {
      version: "0.1.0",
      hostId: "host_dev",
      baseUrl: "http://127.0.0.1:8787",
      capabilities: ["endpoint_manifests", "host_cache", "webrtc_forwarding"],
      supportedOutputs: ["forwarder", "local", "file"]
    };

    expect(descriptor.version).toBe("0.1.0");
    expect(descriptor.capabilities).toContain("host_cache");
  });
});

describe("host policy shape", () => {
  it("models allow and deny results", () => {
    const allowed: HostPolicyResult = {
      descriptor: {
        hostId: "host_dev",
        accountTier: "dev",
        supportedOutputs: ["forwarder", "local", "file"],
        debug: false,
        cache: {
          available: true,
          quotaRemainingBytes: 1_000,
          retentionDays: 7,
          receipts: "required"
        },
        live: {
          minDurationSeconds: 0,
          maxDurationSeconds: 3600
        },
        evaluation: {
          ruleSet: "livestreak-host-policy",
          status: "pass",
          warnings: []
        }
      },
      outputMode: "forwarder",
      cache: {
        intent: "required",
        required: true,
        maySkip: false,
        available: true,
        expectedBytes: 0,
        quotaRemainingBytes: 1_000
      },
      live: {
        required: true,
        available: true,
        expectedDurationSeconds: 3600
      },
      blockReasons: [],
      constraints: []
    };

    const denied: HostPolicyResult = {
      ...allowed,
      descriptor: {
        ...allowed.descriptor,
        evaluation: {
          ruleSet: "livestreak-host-policy",
          status: "blocked",
          warnings: []
        }
      },
      blockReasons: ["unsupported_output"]
    };

    expect(allowed.descriptor.evaluation.status).toBe("pass");
    expect(denied.blockReasons).toEqual(["unsupported_output"]);
  });
});

describe("aa descriptor shape", () => {
  it("accepts a capability document", () => {
    const descriptor: AaCapabilityDescriptor = {
      version: "0.1.0",
      hostId: "host_dev",
      sponsorshipMode: "dev_open",
      supportedOperations: ["user_operation"],
      paymasterPath: "/aa/paymaster",
      chains: [
        {
          chainId: 31_337,
          name: "local",
          entryPoint: "0xentrypoint",
          bundlerPath: "/aa/bundler/local"
        }
      ]
    };

    expect(descriptor.chains[0]?.chainId).toBe(31_337);
  });
});

describe("host similarity shape", () => {
  it("accepts request and result records", () => {
    const result: HostSimilarityResult = {
      marketId: "mkt_01",
      candidates: [
        {
          kind: "vault",
          vaultId: "vlt_01",
          marketId: "mkt_01",
          score: 0.8,
          reason: "token overlap within market",
          suggestedAction: "join-existing"
        }
      ],
      duplicateRisk: "high"
    };

    expect(result.candidates[0]?.suggestedAction).toBe("join-existing");
  });
});
