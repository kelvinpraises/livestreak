import { describe, expect, it } from "vitest";
import { buildVaultDraft } from "../src/draft/build.js";
import { projectBookmakerPanel } from "../src/panel/project.js";
import { detection, marketContext, similarityResult, vaultDraft, watchSource } from "./helpers/fixtures.js";

describe("buildVaultDraft", () => {
  it("builds a market-scoped vault draft from detection and observe context", () => {
    const draft = buildVaultDraft(detection(), marketContext(), {
      fundingToken: "0xusdc",
      nowMs: 1_000
    });

    expect(draft.marketId).toBe("market-1");
    expect(draft.question).toContain("Team A score");
    expect(draft.resolutionSource).toBe("football-v1");
    expect(draft.resolutionWindow).toEqual({
      opensAtMs: 1_000,
      expiresAtMs: 601_000
    });
    expect(draft.fundingToken).toBe("0xusdc");
  });
});

describe("projectBookmakerPanel", () => {
  it("projects similarity candidates and lifecycle fields for CLI/UI", () => {
    const panel = projectBookmakerPanel({
      runtimeId: "bookmaker-1",
      marketContext: marketContext(),
      watchSource: watchSource(),
      latestDetection: detection(),
      currentDraft: vaultDraft(),
      similarityResult: similarityResult({
        candidates: [
          {
            kind: "vault",
            vaultId: "vault-1",
            marketId: "market-1",
            score: 0.8,
            reason: "similar wording",
            suggestedAction: "create-new"
          }
        ]
      }),
      updatedAtMs: 42
    });

    expect(panel.runtimeId).toBe("bookmaker-1");
    expect(panel.marketId).toBe("market-1");
    expect(panel.marketContext.marketId).toBe("market-1");
    expect(panel.similarityCandidates).toHaveLength(1);
    expect(panel.watchRefs.map((ref) => ref.kind)).toEqual(
      expect.arrayContaining(["watchUrl", "webrtcUrl"])
    );
    expect(panel.updatedAtMs).toBe(42);
  });

  it("surfaces decision, skip reason, and write intents without raw host payloads", () => {
    const draft = vaultDraft();
    const detected = detection();
    const panel = projectBookmakerPanel({
      runtimeId: "bookmaker-1",
      marketContext: marketContext(),
      lastDecision: {
        action: "skip",
        reason: "duplicate_vault",
        detection: detected
      },
      pendingWritePlan: {
        decision: { action: "createVault", draft, detection: detected },
        intents: [{ action: "createVault", marketId: "market-1", draft }]
      },
      updatedAtMs: 99
    });

    expect(panel.decisionAction).toBe("skip");
    expect(panel.skipReason).toBe("duplicate_vault");
    expect(panel.writeIntents).toHaveLength(1);
    expect(panel.writeIntents[0]?.action).toBe("createVault");
    expect(panel).not.toHaveProperty("hostResponse");
    expect(panel).not.toHaveProperty("abi");
  });

  it("serializes to JSON without leaking host, ABI, worker, or transport blobs", () => {
    const panel = projectBookmakerPanel({
      runtimeId: "bookmaker-1",
      marketContext: marketContext(),
      watchSource: watchSource(),
      latestDetection: detection({ suggestedStake: undefined }),
      similarityResult: similarityResult(),
      updatedAtMs: 100
    });

    const json = JSON.stringify(panel);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed.marketId).toBe("market-1");
    expect(json).not.toMatch(/hostResponse|workerState|writeCallDescriptor|"abi"|userOperation|bundler/i);
    expect(parsed).not.toHaveProperty("hostResponse");
    expect(parsed).not.toHaveProperty("abi");
    expect(parsed).not.toHaveProperty("workerState");
    expect(parsed).not.toHaveProperty("transport");
  });
});
