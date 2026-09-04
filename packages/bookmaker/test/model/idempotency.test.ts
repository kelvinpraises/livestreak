import { describe, expect, it } from "vitest";
import { LiveStreakConfigError, LiveStreakRuntimeError, isLiveStreakError } from "@livestreak/core";

import { idempotencyKeyFor, idempotencyKeyFromDraft } from "../../src/model/idempotency.js";
import { originateVault } from "../../src/flows/originate.js";
import { createFakeBookmakerChain, FAKE_MARKET_ID } from "../helpers/fake-bookmaker-chain.js";
import { createTestRuntime } from "../helpers/test-runtime.js";
import { detection, marketContext, similarityResult, vaultDraft } from "../helpers/fixtures.js";

describe("idempotencyKeyFor", () => {
  const base = {
    marketId: "market-1",
    question: "Will Team A score?",
    resolutionSource: "football-v1",
    resolutionWindowExpiresAtMs: 1_700_000_600_000,
    creatorSide: "yes" as const
  };

  it("is deterministic for identical defining fields", () => {
    expect(idempotencyKeyFor(base)).toBe(idempotencyKeyFor({ ...base }));
  });

  it("normalizes question whitespace and case", () => {
    const left = idempotencyKeyFor({ ...base, question: "  Will   TEAM A   score?  " });
    const right = idempotencyKeyFor({ ...base, question: "will team a score?" });
    expect(left).toBe(right);
  });

  it("changes when side, question, window, market, or source changes", () => {
    const original = idempotencyKeyFor(base);
    expect(idempotencyKeyFor({ ...base, creatorSide: "no" })).not.toBe(original);
    expect(idempotencyKeyFor({ ...base, question: "Different question?" })).not.toBe(original);
    expect(idempotencyKeyFor({ ...base, resolutionWindowExpiresAtMs: 1 })).not.toBe(original);
    expect(idempotencyKeyFor({ ...base, marketId: "market-2" })).not.toBe(original);
    expect(idempotencyKeyFor({ ...base, resolutionSource: "other-source" })).not.toBe(original);
  });

  it("ignores bond size fields on the draft", () => {
    const draftA = vaultDraft({ creatorStake: 1_000n, seedRate: 1n });
    const draftB = vaultDraft({ creatorStake: 9_999_999n, seedRate: 99_999n });
    expect(idempotencyKeyFromDraft(draftA)).toBe(idempotencyKeyFromDraft(draftB));
  });
});

describe("originateVault idempotency", () => {
  it("creates once for duplicate originate calls with the same guarded executor", async () => {
    let createCalls = 0;
    const runtime = createTestRuntime(
      createFakeBookmakerChain(() => {
        createCalls += 1;
        return {
          txId: `0x${"aa".repeat(32)}` as const,
          vaultId: `0x${"22".repeat(32)}` as const
        };
      })
    );

    const evaluation = {
      action: "detected" as const,
      detection: detection(),
      detectorId: "momentum"
    };
    const input = {
      evaluation,
      marketContext: marketContext({ marketId: FAKE_MARKET_ID }),
      fundingToken: "0x0000000000000000000000000000000000000002",
      policy: { duplicatePolicy: "always-create" as const, detection: evaluation.detection },
      similarityClient: { findSimilar: async () => similarityResult({ marketId: FAKE_MARKET_ID }) },
      nowMs: 10_000,
      guardedCreateVault: runtime.createVaultOnce.bind(runtime)
    };

    const first = await originateVault(input);
    const second = await originateVault(input);

    expect(createCalls).toBe(1);
    expect(first.action).toBe("created");
    expect(second.action).toBe("created");
    if (first.action !== "created" || second.action !== "created") {
      return;
    }

    expect(second.idempotent).toBe(true);
    expect(second.result).toEqual(first.result);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });
});

describe("originateVault core errors", () => {
  it("throws LiveStreakConfigError for non-detected evaluation", async () => {
    const runtime = createTestRuntime(createFakeBookmakerChain());

    await expect(
      originateVault({
        evaluation: { action: "skip", reason: "no_detection", detectorCount: 0 },
        marketContext: marketContext(),
        fundingToken: "0xusdc",
        policy: { duplicatePolicy: "always-create", detection: detection() },
        similarityClient: { findSimilar: async () => similarityResult() },
        nowMs: 1,
        guardedCreateVault: runtime.createVaultOnce.bind(runtime)
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);
  });
});

describe("parseVaultCreatedFromLogs core errors", () => {
  it("throws LiveStreakRuntimeError when no VaultCreated log is present", async () => {
    const { parseVaultCreatedFromLogs } = await import("../../src/chains/evm/decode.js");

    expect(() => parseVaultCreatedFromLogs([])).toThrow(LiveStreakRuntimeError);
    try {
      parseVaultCreatedFromLogs([]);
    } catch (error) {
      expect(isLiveStreakError(error)).toBe(true);
      expect(error).toBeInstanceOf(LiveStreakRuntimeError);
    }
  });
});
