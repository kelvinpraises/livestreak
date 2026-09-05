import { describe, expect, it } from "vitest";
import { detectOpportunity } from "../../src/pipeline/detection/evaluate.js";
import { createEventKindDetector } from "../../src/pipeline/detection/factories.js";
import { originateVault } from "../../src/flows/originate.js";
import { validateVaultDraftForCreate } from "../../src/model/validate.js";
import type { BookmakerSimilarityClient, VaultIndexRecord } from "../../src/pipeline/similarity/client.js";
import type { SimilarityCandidate } from "../../src/model/similarity.js";
import { createFakeBookmakerChain, FAKE_MARKET_ID, FAKE_VAULT_ID } from "../helpers/fake-bookmaker-chain.js";
import { createTestRuntime } from "../helpers/test-runtime.js";
import { marketContext, vaultDraft } from "../helpers/fixtures.js";

// In-memory stand-in for the host discovery index: stores indexed vaults and
// echoes their precomputed `vaultKey` on find (mirrors the host round-trip).
const createInMemoryDiscoveryClient = (): BookmakerSimilarityClient & {
  readonly indexed: VaultIndexRecord[];
} => {
  const indexed: VaultIndexRecord[] = [];

  return {
    indexed,
    findSimilar: async (query) => {
      const candidates: SimilarityCandidate[] = indexed
        .filter((record) => record.marketId === query.marketId)
        .map((record) => ({
          kind: "vault",
          vaultId: record.vaultId,
          marketId: record.marketId,
          score: 1,
          reason: "indexed vault",
          suggestedAction: "join-existing",
          vaultKey: record.vaultKey
        }));

      return {
        marketId: query.marketId,
        candidates,
        duplicateRisk: "low"
      };
    },
    indexVault: async (record) => {
      indexed.push(record);
    }
  };
};

const buildDetectedEvaluation = (nowMs: number) => {
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

  return detectOpportunity({
    marketContext: marketContext({ marketId: FAKE_MARKET_ID }),
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
};

describe("register-on-create + deterministic dedup", () => {
  const nowMs = 10_000;
  const fundingToken = "0x0000000000000000000000000000000000000002";

  it("registers a created vault then joins it on the next identical origination", async () => {
    const discovery = createInMemoryDiscoveryClient();

    let createCalls = 0;
    const chain = createFakeBookmakerChain(() => {
      createCalls += 1;
      return { txId: `0x${"aa".repeat(32)}` as const, vaultId: FAKE_VAULT_ID };
    });
    const runtime = createTestRuntime(chain);

    const originateOnce = () => {
      const evaluation = buildDetectedEvaluation(nowMs);
      if (evaluation.action !== "detected") {
        throw new Error("expected a detected evaluation");
      }
      return originateVault({
        evaluation,
        marketContext: marketContext({ marketId: FAKE_MARKET_ID }),
        fundingToken,
        policy: { duplicatePolicy: "prefer-join", detection: evaluation.detection },
        similarityClient: discovery,
        nowMs,
        guardedCreateVault: runtime.createVaultOnce.bind(runtime)
      });
    };

    const first = await originateOnce();
    expect(first.action).toBe("created");
    // B2: the created vault was registered in the discovery index, with a vaultKey.
    expect(discovery.indexed).toHaveLength(1);
    expect(discovery.indexed[0]?.vaultId).toBe(FAKE_VAULT_ID);
    expect(typeof discovery.indexed[0]?.vaultKey).toBe("string");
    expect(discovery.indexed[0]?.vaultKey.length).toBeGreaterThan(0);

    const second = await originateOnce();
    // B1: the echoed vaultKey drives a DETERMINISTIC exact-match join — no dupe.
    expect(second.action).toBe("joined");
    if (second.action === "joined") {
      expect(second.vaultId).toBe(FAKE_VAULT_ID);
    }
    expect(createCalls).toBe(1);
    // No second index entry (a join does not register a new vault).
    expect(discovery.indexed).toHaveLength(1);
  });

  it("is fail-open: a discovery index error never fails the create", async () => {
    const indexErrors: unknown[] = [];
    const failingDiscovery: BookmakerSimilarityClient = {
      findSimilar: async (query) => ({ marketId: query.marketId, candidates: [], duplicateRisk: "low" }),
      indexVault: async () => {
        throw new Error("discovery index unavailable");
      }
    };

    const chain = createFakeBookmakerChain(() => ({
      txId: `0x${"bb".repeat(32)}` as const,
      vaultId: FAKE_VAULT_ID
    }));
    const runtime = createTestRuntime(chain);

    const evaluation = buildDetectedEvaluation(nowMs);
    if (evaluation.action !== "detected") {
      throw new Error("expected a detected evaluation");
    }

    const result = await originateVault({
      evaluation,
      marketContext: marketContext({ marketId: FAKE_MARKET_ID }),
      fundingToken,
      policy: { duplicatePolicy: "always-create", detection: evaluation.detection },
      similarityClient: failingDiscovery,
      nowMs,
      guardedCreateVault: runtime.createVaultOnce.bind(runtime),
      onIndexError: (error) => indexErrors.push(error)
    });

    expect(result.action).toBe("created");
    expect(indexErrors).toHaveLength(1);
  });
});

describe("seed-rate floor", () => {
  it("rejects a seed rate below the chain streaming minimum with a clear error", () => {
    const draft = vaultDraft({ seedRate: 5n });
    const result = validateVaultDraftForCreate(draft, 1_000, { minSeedRate: 100n });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.issues.join(" ")).toContain("chain streaming minimum");
    }
  });

  it("accepts a seed rate at or above the minimum", () => {
    const draft = vaultDraft({ seedRate: 8_333n });
    const result = validateVaultDraftForCreate(draft, 1_000, { minSeedRate: 1n });
    expect(result.ok).toBe(true);
  });

  it("still rejects a zero/underflowed seed rate", () => {
    const draft = vaultDraft({ seedRate: 0n });
    const result = validateVaultDraftForCreate(draft, 1_000);
    expect(result.ok).toBe(false);
  });
});
