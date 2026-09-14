import { describe, expect, it } from "vitest";

import { createBookmakerBridge } from "../../src/bridge/bridge.js";
import { bridgeActionScope } from "../../src/bridge/types.js";
import { buildCreateVaultIntent } from "../../src/model/write-intent.js";
import type { BookmakerSimilarityClient, VaultIndexRecord } from "../../src/pipeline/similarity/client.js";
import { createBookmakerRuntime } from "../../src/runtime/runtime.js";
import { createFakeBookmakerChain, FAKE_MARKET_ID } from "../helpers/fake-bookmaker-chain.js";
import { testRuntimeConfig } from "../helpers/test-runtime.js";
import { vaultDraft } from "../helpers/fixtures.js";

// Console path parity with the originate flow (B2): a vault created through
// runtime.createVaultOnce (the bridge's live path) must land in the host discovery
// index, fail-open, skipping idempotent re-creates.
describe("runtime createVaultOnce discovery-index registration", () => {
  const nowMs = 10_000;

  const recordingClient = (
    failWith?: Error
  ): BookmakerSimilarityClient & { readonly indexed: VaultIndexRecord[] } => {
    const indexed: VaultIndexRecord[] = [];
    return {
      indexed,
      findSimilar: async () => ({ marketId: FAKE_MARKET_ID, candidates: [] }),
      indexVault: async (record) => {
        if (failWith !== undefined) {
          throw failWith;
        }
        indexed.push(record);
      }
    };
  };

  const makeRuntime = (client: BookmakerSimilarityClient) =>
    createBookmakerRuntime({
      config: testRuntimeConfig({ similarityClient: client }),
      chain: createFakeBookmakerChain()
    });

  const intent = buildCreateVaultIntent(vaultDraft({ marketId: FAKE_MARKET_ID }));

  it("registers a created vault with vaultKey = idempotencyKey and the honest draft", async () => {
    const client = recordingClient();
    const runtime = makeRuntime(client);

    const res = await runtime.createVaultOnce(intent, nowMs);

    expect(client.indexed).toHaveLength(1);
    const record = client.indexed[0]!;
    expect(record.vaultId).toBe(res.result.vaultId);
    expect(record.marketId).toBe(FAKE_MARKET_ID);
    expect(record.vaultKey).toBe(res.idempotencyKey);
    // The draft is rebuilt honestly from the intent + runtime config.
    expect(record.draft.question).toBe(intent.question);
    expect(record.draft.creatorSide).toBe(intent.creatorSide);
    expect(record.draft.resolutionWindow.expiresAtMs).toBe(intent.resolutionWindowExpiresAtMs);
    expect(record.draft.fundingToken).toBe(testRuntimeConfig().fundingToken);
    // Success leaves no error on the panel.
    expect(runtime.readPanel().lastError).toBeUndefined();
  });

  it("skips indexing on an idempotent re-create", async () => {
    const client = recordingClient();
    const runtime = makeRuntime(client);

    await runtime.createVaultOnce(intent, nowMs);
    const second = await runtime.createVaultOnce(intent, nowMs);

    expect(second.idempotent).toBe(true);
    expect(client.indexed).toHaveLength(1);
  });

  it("fails open: an index failure never fails the create, and lands on the panel", async () => {
    const client = recordingClient(new Error("discovery down"));
    const runtime = makeRuntime(client);

    const res = await runtime.createVaultOnce(intent, nowMs);

    expect(res.result.vaultId).toBeTruthy();
    expect(res.idempotent).toBe(false);
    const lastError = runtime.readPanel().lastError;
    expect(lastError).toContain("discovery index registration failed");
    expect(lastError).toContain("discovery down");
    // The create itself is still recorded as completed.
    expect(runtime.readPanel().completedVaultCreations).toHaveLength(1);
  });

  it("indexes through the live console path (bridge callAction createVault)", async () => {
    const client = recordingClient();
    const runtime = makeRuntime(client);
    const bridge = createBookmakerBridge({ runtime });
    const caller = {
      id: "agent-1",
      grants: [
        {
          id: "grant-action",
          sessionId: "session-1",
          holder: "agent-1",
          scopes: [bridgeActionScope] as const,
          revoked: false
        }
      ]
    };

    const result = await bridge.callAction(
      caller,
      {
        scope: bridgeActionScope,
        action: "createVault",
        args: {
          marketId: intent.marketId,
          question: intent.question,
          creatorSide: intent.creatorSide,
          creatorStake: intent.creatorStake,
          seedRate: intent.seedRate,
          resolutionSource: intent.resolutionSource,
          resolutionWindowExpiresAtMs: intent.resolutionWindowExpiresAtMs
        }
      },
      nowMs
    );

    expect(client.indexed).toHaveLength(1);
    expect(client.indexed[0]!.vaultId).toBe(result.vaultId);
    expect(client.indexed[0]!.vaultKey.length).toBeGreaterThan(0);
  });
});
