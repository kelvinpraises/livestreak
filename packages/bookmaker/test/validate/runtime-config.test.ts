import { describe, expect, it } from "vitest";
import { validateBookmakerRuntimeConfig } from "../../src/validate/runtime-config.js";
import { detection, marketContext, watchSource } from "../helpers/fixtures.js";

describe("validateBookmakerRuntimeConfig", () => {
  const validConfig = {
    runtimeId: "bookmaker-1",
    marketContext: marketContext(),
    watchSource: watchSource(),
    policy: {
      duplicatePolicy: "prefer-join",
      detection: detection()
    },
    fundingToken: "0x0000000000000000000000000000000000000002"
  } as const;

  it("accepts a valid runtime config", () => {
    const result = validateBookmakerRuntimeConfig(validConfig);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.runtimeId).toBe("bookmaker-1");
      expect(result.value.marketContext.marketId).toBe("market-1");
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

  it("rejects invalid optional contracts surface", () => {
    const result = validateBookmakerRuntimeConfig({
      ...validConfig,
      contracts: { vaultAddress: "" }
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues).toContain("contracts must include a non-empty vaultAddress when provided");
    }
  });
});
