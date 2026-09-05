import { describe, expect, it } from "vitest";
import { validateBookmakerRuntimeConfig } from "../../src/runtime/validate.js";
import { detection, marketContext, watchSource } from "../helpers/fixtures.js";

const chainFields = {
  walletInit: {
    chain: "evm",
    seedSource: "raw",
    config: {
      chainId: 31_337,
      provider: "http://127.0.0.1:8545",
      bundlerUrl: "http://127.0.0.1:4337",
      isSponsored: false,
      useNativeCoins: false,
      entryPointAddress: "0x0000000000000000000000000000000000000001",
      safe4337ModuleAddress: "0x0000000000000000000000000000000000000002",
      safeModulesSetupAddress: "0x0000000000000000000000000000000000000003",
      safeModulesVersion: "0.3.0",
      contractNetworks: {}
    }
  },
  seed: "test-seed",
  addresses: {
    vaultDriver: "0x0000000000000000000000000000000000000010",
    marketRegistry: "0x0000000000000000000000000000000000000011",
    vault: "0x0000000000000000000000000000000000000014",
    usdc: "0x00000000000000000000000000000000000000aa"
  }
} as const;

describe("validateBookmakerRuntimeConfig", () => {
  const validConfig = {
    runtimeId: "bookmaker-1",
    marketContext: marketContext(),
    watchSource: watchSource(),
    policy: {
      duplicatePolicy: "prefer-join",
      detection: detection()
    },
    fundingToken: "0x0000000000000000000000000000000000000002",
    ...chainFields
  } as const;

  it("accepts a valid runtime config", () => {
    const result = validateBookmakerRuntimeConfig(validConfig);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.runtimeId).toBe("bookmaker-1");
      expect(result.value.marketContext.marketId).toBe("market-1");
      expect(result.value.addresses.vaultDriver).toBe(chainFields.addresses.vaultDriver);
    }
  });

  it("rejects missing market context", () => {
    const result = validateBookmakerRuntimeConfig({
      ...validConfig,
      marketContext: {}
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues.some((issue) => issue.startsWith("marketContext."))).toBe(true);
    }
  });

  it("rejects watch source market mismatch", () => {
    const result = validateBookmakerRuntimeConfig({
      ...validConfig,
      watchSource: watchSource({ marketId: "market-2" })
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues).toContain("watchSource.marketId must match marketContext.marketId");
    }
  });

  it("rejects malformed policy", () => {
    const result = validateBookmakerRuntimeConfig({
      ...validConfig,
      policy: {
        duplicatePolicy: "auto-merge",
        detection: {}
      }
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues.some((issue) => issue.includes("duplicatePolicy"))).toBe(true);
    }
  });

  it("accepts optional similarity client as a shape without executing it", () => {
    let called = false;
    const findSimilar = () => {
      called = true;
      return Promise.resolve({ marketId: "market-1", candidates: [] });
    };
    const result = validateBookmakerRuntimeConfig({
      ...validConfig,
      similarityClient: { findSimilar }
    });

    expect(result.ok).toBe(true);
    expect(called).toBe(false);
  });

  it("rejects invalid addresses", () => {
    const result = validateBookmakerRuntimeConfig({
      ...validConfig,
      addresses: { vaultDriver: "" }
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues).toContain(
        "addresses must include vaultDriver, marketRegistry, vault, and usdc"
      );
    }
  });
});
