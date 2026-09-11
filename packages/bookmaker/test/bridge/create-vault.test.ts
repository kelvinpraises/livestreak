import { describe, expect, it } from "vitest";
import { LiveStreakCapabilityError, LiveStreakConfigError } from "@livestreak/core";

import { createBookmakerBridge } from "../../src/bridge/bridge.js";
import { bridgeActionScope } from "../../src/bridge/types.js";
import { createFakeBookmakerChain, FAKE_MARKET_ID } from "../helpers/fake-bookmaker-chain.js";
import { createTestRuntime } from "../helpers/test-runtime.js";
import { vaultDraft } from "../helpers/fixtures.js";

import type { CapabilityGrant } from "../../src/bridge/types.js";

const actionCaller = (grants: readonly CapabilityGrant[]) => ({
  id: "agent-1",
  grants
});

describe("bookmaker bridge createVault wiring", () => {
  const nowMs = 10_000;
  const draft = vaultDraft({ marketId: FAKE_MARKET_ID });
  const createArgs = {
    marketId: draft.marketId,
    question: draft.question,
    creatorSide: draft.creatorSide,
    creatorStake: draft.creatorStake,
    seedRate: draft.seedRate,
    resolutionSource: draft.resolutionSource,
    resolutionWindowExpiresAtMs: draft.resolutionWindow.expiresAtMs
  };

  const actionGrant = {
    id: "grant-action",
    sessionId: "session-1",
    holder: "agent-1",
    scopes: [bridgeActionScope] as const,
    revoked: false
  };

  it("deduplicates createVault through the runtime store", async () => {
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
    const bridge = createBookmakerBridge({ runtime });
    const caller = actionCaller([actionGrant]);
    const envelope = {
      scope: bridgeActionScope,
      action: "createVault",
      args: createArgs
    } as const;

    const first = await bridge.callAction(caller, envelope, nowMs);
    const second = await bridge.callAction(caller, envelope, nowMs);

    expect(createCalls).toBe(1);
    // P1: callAction now returns { txId, vaultId } (vaultId previously dropped).
    expect(first).toEqual({
      txId: `0x${"aa".repeat(32)}`,
      vaultId: `0x${"22".repeat(32)}`
    });
    expect(second).toEqual(first);
  });

  it("coerces numeric-string creatorStake/seedRate and creates the vault", async () => {
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
    const bridge = createBookmakerBridge({ runtime });

    // The remote console serializes args as JSON, which has no bigint — amounts
    // arrive as decimal strings, so the bridge must coerce them before validation.
    const result = await bridge.callAction(
      actionCaller([actionGrant]),
      {
        scope: bridgeActionScope,
        action: "createVault",
        args: { ...createArgs, creatorStake: "5000000", seedRate: "8333" }
      },
      nowMs
    );

    expect(createCalls).toBe(1);
    expect(result).toEqual({
      txId: `0x${"aa".repeat(32)}`,
      vaultId: `0x${"22".repeat(32)}`
    });
  });

  it("rejects a non-coercible creatorStake without calling the writer", async () => {
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
    const bridge = createBookmakerBridge({ runtime });

    await expect(
      bridge.callAction(
        actionCaller([actionGrant]),
        {
          scope: bridgeActionScope,
          action: "createVault",
          // An object cannot coerce to bigint → the field is dropped → validation rejects.
          args: { ...createArgs, creatorStake: { not: "a number" } }
        },
        nowMs
      )
    ).rejects.toBeInstanceOf(LiveStreakConfigError);

    expect(createCalls).toBe(0);
  });
});

describe("bookmaker bridge capability expiry", () => {
  const expiredGrant = {
    id: "grant-expired",
    sessionId: "session-1",
    holder: "agent-1",
    scopes: [bridgeActionScope] as const,
    expiresAt: 1_000,
    revoked: false
  };

  it("rejects expired grants when nowMs is after expiresAt", async () => {
    const runtime = createTestRuntime(createFakeBookmakerChain());
    const bridge = createBookmakerBridge({ runtime });

    await expect(
      bridge.callAction(
        actionCaller([expiredGrant]),
        {
          scope: bridgeActionScope,
          action: "createVault",
          args: {}
        },
        2_000
      )
    ).rejects.toBeInstanceOf(LiveStreakCapabilityError);
  });

  it("allows grants when nowMs is before expiresAt", async () => {
    const runtime = createTestRuntime(createFakeBookmakerChain());
    const bridge = createBookmakerBridge({ runtime });
    const draft = vaultDraft({ marketId: FAKE_MARKET_ID });

    await expect(
      bridge.callAction(
        actionCaller([expiredGrant]),
        {
          scope: bridgeActionScope,
          action: "createVault",
          args: {
            marketId: draft.marketId,
            question: draft.question,
            creatorSide: draft.creatorSide,
            creatorStake: draft.creatorStake,
            seedRate: draft.seedRate,
            resolutionSource: draft.resolutionSource,
            resolutionWindowExpiresAtMs: draft.resolutionWindow.expiresAtMs
          }
        },
        500
      )
    ).resolves.toBeDefined();
  });
});
