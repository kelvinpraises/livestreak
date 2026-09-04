import { describe, expect, it } from "vitest";

import { originateVault } from "../../src/flows/originate.js";
import type { OriginateVaultInput } from "../../src/flows/originate.js";
import { createFakeBookmakerChain, FAKE_MARKET_ID } from "../helpers/fake-bookmaker-chain.js";
import { createTestRuntime } from "../helpers/test-runtime.js";
import { detection, marketContext, similarityResult } from "../helpers/fixtures.js";

describe("OriginateVaultInput", () => {
  it("requires guardedCreateVault and cannot silently use a private store", () => {
    const input: OriginateVaultInput = {
      evaluation: {
        action: "detected",
        detection: detection(),
        detectorId: "momentum"
      },
      marketContext: marketContext({ marketId: FAKE_MARKET_ID }),
      fundingToken: "0x0000000000000000000000000000000000000002",
      policy: { duplicatePolicy: "always-create", detection: detection() },
      similarityClient: { findSimilar: async () => similarityResult({ marketId: FAKE_MARKET_ID }) },
      nowMs: 10_000,
      guardedCreateVault: createTestRuntime(createFakeBookmakerChain()).createVaultOnce.bind(
        createTestRuntime(createFakeBookmakerChain())
      )
    };

    expect(input.guardedCreateVault).toBeTypeOf("function");
    expect("chain" in input).toBe(false);
    expect("idempotencyStore" in input).toBe(false);
  });
});

describe("originate and bridge share runtime idempotency store", () => {
  it("deduplicates originate then bridge through one runtime store", async () => {
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
    const nowMs = 10_000;

    const originated = await originateVault({
      evaluation,
      marketContext: marketContext({ marketId: FAKE_MARKET_ID }),
      fundingToken: "0x0000000000000000000000000000000000000002",
      policy: { duplicatePolicy: "always-create", detection: evaluation.detection },
      similarityClient: { findSimilar: async () => similarityResult({ marketId: FAKE_MARKET_ID }) },
      nowMs,
      guardedCreateVault: runtime.createVaultOnce.bind(runtime)
    });

    expect(originated.action).toBe("created");
    if (originated.action !== "created") {
      return;
    }

    const bridge = (await import("../../src/bridge/bridge.js")).createBookmakerBridge({ runtime });
    await bridge.callAction(
      { id: "agent-1", trusted: true },
      {
        scope: "bridge:action",
        action: "createVault",
        args: originated.intent
      },
      nowMs
    );

    expect(createCalls).toBe(1);
  });
});
