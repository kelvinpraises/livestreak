import { describe, expect, it } from "vitest";
import { detectOpportunity } from "../../src/detection/evaluate.js";
import { createEventKindDetector } from "../../src/detection/factories.js";
import { buildWriteIntentsFromDecision } from "../../src/model/write-intent.js";
import { originateVault } from "../../src/flows/originate.js";
import { DISCOVERY_FIND_PATH } from "../../src/similarity/host-client.js";
import { createFakeBookmakerChain, FAKE_MARKET_ID, FAKE_VAULT_ID } from "../helpers/fake-bookmaker-chain.js";
import { createTestRuntime } from "../helpers/test-runtime.js";
import { marketContext, similarityResult } from "../helpers/fixtures.js";

describe("originate vault e2e", () => {
  const nowMs = 10_000;
  const bytesMarketContext = marketContext({ marketId: FAKE_MARKET_ID });
  const fundingToken = "0x0000000000000000000000000000000000000002";

  it("runs detect -> draft -> discovery/find -> decide -> execute with fake host and chain", async () => {
    const discoveryCalls: string[] = [];
    const similarityClient = {
      findSimilar: async () => {
        discoveryCalls.push(DISCOVERY_FIND_PATH);
        return similarityResult({ marketId: FAKE_MARKET_ID });
      }
    };

    const createCalls: Array<{ marketId: string; question: string }> = [];
    const chain = createFakeBookmakerChain((input) => {
      createCalls.push({ marketId: input.marketId, question: input.question });
      return {
        txId: `0x${"aa".repeat(32)}` as const,
        vaultId: FAKE_VAULT_ID
      };
    });

    const detector = createEventKindDetector({
      id: "signal-detector",
      kind: "goal-chance",
      question: "Will Team A score in the next 10 minutes?",
      vaultType: "momentum",
      durationSeconds: 600,
      confidence: 0.92,
      suggestedSide: "yes",
      suggestedStake: 5_000_000n
    });

    const evaluation = detectOpportunity({
      marketContext: bytesMarketContext,
      events: [
        {
          marketId: FAKE_MARKET_ID,
          observationId: "obs-goal",
          observedAtMs: nowMs,
          kind: "goal-chance",
          payload: { pressure: 0.8 }
        }
      ],
      detectors: [detector],
      policy: { confidenceThreshold: 0.8 },
      nowMs
    });

    expect(evaluation.action).toBe("detected");
    if (evaluation.action !== "detected") {
      return;
    }

    const runtime = createTestRuntime(chain);

    const result = await originateVault({
      evaluation,
      marketContext: bytesMarketContext,
      fundingToken,
      policy: {
        duplicatePolicy: "always-create",
        detection: evaluation.detection
      },
      similarityClient,
      nowMs,
      guardedCreateVault: runtime.createVaultOnce.bind(runtime)
    });

    expect(discoveryCalls).toEqual([DISCOVERY_FIND_PATH]);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.marketId).toBe(FAKE_MARKET_ID);
    expect(result.action).toBe("created");
    if (result.action !== "created") {
      return;
    }

    expect(result.result.vaultId).toBe(FAKE_VAULT_ID);
    expect(result.idempotent).toBe(false);

    const intents = buildWriteIntentsFromDecision({
      action: "createVault",
      draft: result.draft,
      detection: evaluation.detection
    });
    expect(intents[0]?.action).toBe("createVault");
  });
});
