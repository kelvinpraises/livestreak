import { LiveStreakCapabilityError } from "@livestreak/core";
import { describe, expect, it, vi } from "vitest";

import {
  bridgeActionScope,
  bridgeBoardReadScope,
  createStewardBridge,
  projectStewardControls
} from "../src/bridge/index.js";
import { createStewardRuntime } from "../src/runtime/runtime.js";
import {
  emptyMemoryPorts,
  makeFakeContractFactSource,
  makeFakeHostFactSource,
  makeFakeObserveFactSource,
  makeRecordingActionPlanSink
} from "./fakes/runtime-sources.js";

const vaultSubject = {
  kind: "vault" as const,
  id: "vault-1",
  marketId: "market-1",
  vaultId: "vault-1"
};

const stewardSubject = {
  kind: "steward" as const,
  id: "steward-bad"
};

const baseConfig = {
  runtimeId: "runtime-bridge",
  watchedSubjects: [vaultSubject, stewardSubject],
  ruleset: { id: "rules", rules: [] },
  decisionPolicy: { id: "policy", mappings: [] },
  actionContext: { stewardId: "steward-1" }
};

const trustedCaller = { id: "trusted", trusted: true as const };

const makeRuntime = () => {
  const actionPlanSink = makeRecordingActionPlanSink();
  const runtime = createStewardRuntime({
    config: baseConfig,
    contractFactSource: makeFakeContractFactSource({}),
    hostFactSource: makeFakeHostFactSource({}),
    observeFactSource: makeFakeObserveFactSource({}),
    ...emptyMemoryPorts(),
    actionPlanSink
  });

  return { runtime, actionPlanSink };
};

describe("steward bridge", () => {
  it("rejects callers without the required scope", async () => {
    const bridge = createStewardBridge({ runtime: makeRuntime().runtime });

    await expect(
      bridge.readBoard({ id: "guest", grants: [{ id: "g1", sessionId: "s1", holder: "guest", scopes: [], revoked: false }] })
    ).rejects.toBeInstanceOf(LiveStreakCapabilityError);
  });

  it("allows trusted callers to read board and controls", async () => {
    const { runtime } = makeRuntime();
    const bridge = createStewardBridge({ runtime });

    const board = await bridge.readBoard(trustedCaller);
    expect(board.revision).toBe(0);

    const controls = await bridge.readControls(trustedCaller);
    expect(controls.functions.length).toBeGreaterThan(0);
  });

  it("projects per-subject disabled rules in controls", async () => {
    const { runtime } = makeRuntime();
    await runtime.refresh();

    const controls = projectStewardControls(runtime.readSnapshot(), runtime.readBoard().revision);
    const triggerHot = controls.functions.find(
      (entry) => entry.name === "triggerHot" && entry.target?.subjectId === "vault-1"
    );
    const veto = controls.functions.find(
      (entry) => entry.name === "vetoSteward" && entry.target?.subjectId === "steward-bad"
    );
    const vetoOnVault = controls.functions.find(
      (entry) => entry.name === "vetoSteward" && entry.target?.subjectId === "vault-1"
    );

    expect(triggerHot?.disabled).toBe(true);
    expect(veto?.disabled).toBe(false);
    expect(vetoOnVault?.disabled).toBe(true);
  });

  it("callAction returns a plan and submits to the sink without executing", async () => {
    const { runtime, actionPlanSink } = makeRuntime();
    const bridge = createStewardBridge({ runtime });
    const submitSpy = vi.spyOn(actionPlanSink, "submit");

    const plan = await bridge.callAction(trustedCaller, {
      scope: bridgeActionScope,
      action: "annotate",
      args: { subjectId: "vault-1", reason: "Manual annotation" }
    });

    expect(plan.hostActions[0]?.kind).toBe("annotate");
    expect(submitSpy).toHaveBeenCalledWith([plan]);
    expect(plan.contractCalls).toEqual([]);
  });

  it("bumps board revision across refreshes and notifies subscribeBoard", async () => {
    const { runtime } = makeRuntime();
    const bridge = createStewardBridge({ runtime });
    const listener = vi.fn();

    const unsubscribe = bridge.subscribeBoard(trustedCaller, listener);
    await runtime.refresh();
    unsubscribe();

    expect(runtime.readBoard().revision).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]?.revision).toBe(1);
  });

  it("rejects readBoard without bridge:board:read scope", async () => {
    const bridge = createStewardBridge({ runtime: makeRuntime().runtime });

    await expect(
      bridge.readBoard({
        id: "limited",
        grants: [
          {
            id: "g1",
            sessionId: "s1",
            holder: "limited",
            scopes: [bridgeBoardReadScope],
            revoked: true
          }
        ]
      })
    ).rejects.toBeInstanceOf(LiveStreakCapabilityError);
  });
});
