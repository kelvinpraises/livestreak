import { describe, expect, it } from "vitest";
import { validateCreateVaultIntent } from "../../src/validate/write-intent.js";

describe("validateCreateVaultIntent", () => {
  const nowMs = 10_000;

  it("accepts a valid createVault intent", () => {
    const result = validateCreateVaultIntent(
      {
        action: "createVault",
        marketId: "market-1",
        question: "Will Team A score?",
        creatorSide: "yes",
        creatorStake: 5_000_000n,
        seedRate: 8_333n,
        resolutionSource: "football-v1",
        resolutionWindowExpiresAtMs: 1_700_000_600_000
      },
      nowMs
    );

    expect(result.ok).toBe(true);
  });

  it("rejects stake <= 0", () => {
    const result = validateCreateVaultIntent(
      {
        action: "createVault",
        marketId: "market-1",
        question: "Will Team A score?",
        creatorSide: "yes",
        creatorStake: 0n,
        seedRate: 8_333n
      },
      nowMs
    );

    expect(result.ok).toBe(false);
  });

  it("rejects rate <= 0", () => {
    const result = validateCreateVaultIntent(
      {
        action: "createVault",
        marketId: "market-1",
        question: "Will Team A score?",
        creatorSide: "yes",
        creatorStake: 5_000_000n,
        seedRate: 0n
      },
      nowMs
    );

    expect(result.ok).toBe(false);
  });

  it("rejects empty question", () => {
    const result = validateCreateVaultIntent(
      {
        action: "createVault",
        marketId: "market-1",
        question: "  ",
        creatorSide: "yes",
        creatorStake: 5_000_000n,
        seedRate: 8_333n,
        resolutionSource: "football-v1",
        resolutionWindowExpiresAtMs: 1_700_000_600_000
      },
      nowMs
    );

    expect(result.ok).toBe(false);
  });
});
