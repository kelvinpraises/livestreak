import { LiveStreakCapabilityError } from "@livestreak/core";
import { describe, expect, it } from "vitest";

import { bridgeActionScope, createStewardBridge } from "../src/bridge/index.js";
import type { CapabilityGrant, CapabilityScope } from "../src/bridge/index.js";
import { createStewardRuntime } from "../src/runtime/runtime.js";
import {
  emptyMemoryPorts,
  makeFakeContractFactSource,
  makeFakeHostFactSource,
  makeFakeObserveFactSource,
  makeRecordingActionPlanSink
} from "./fakes/runtime-sources.js";

const stewardSubject = { kind: "steward" as const, id: "steward-bad" };

const baseConfig = {
  runtimeId: "runtime-authz",
  watchedSubjects: [stewardSubject],
  ruleset: { id: "rules", rules: [] },
  decisionPolicy: { id: "policy", mappings: [] },
  actionContext: { stewardId: "steward-1", targetStewardId: "steward-bad" }
};

const makeBridge = () =>
  createStewardBridge({
    runtime: createStewardRuntime({
      config: baseConfig,
      contractFactSource: makeFakeContractFactSource({}),
      hostFactSource: makeFakeHostFactSource({}),
      observeFactSource: makeFakeObserveFactSource({}),
      ...emptyMemoryPorts(),
      actionPlanSink: makeRecordingActionPlanSink()
    })
  });

const callerWith = (scopes: readonly CapabilityScope[]) => ({
  id: "remote-op",
  grants: [
    { id: "g1", sessionId: "s1", holder: "remote-op", scopes, revoked: false } satisfies CapabilityGrant
  ]
});

describe("steward bridge authorization is GRANULAR (S2)", () => {
  it("REJECTS a caller holding only the broad bridge:action permission", async () => {
    const bridge = makeBridge();
    await expect(
      bridge.callAction(callerWith([bridgeActionScope]), {
        scope: bridgeActionScope,
        action: "vetoSteward",
        args: { subjectId: "steward-bad", subjectKind: "steward", reason: "misconduct" }
      })
    ).rejects.toBeInstanceOf(LiveStreakCapabilityError);
  });

  it("ACCEPTS a caller holding the granular steward:steward:vetoSteward scope", async () => {
    const bridge = makeBridge();
    const plan = await bridge.callAction(
      callerWith([bridgeActionScope, "steward:steward:vetoSteward"]),
      {
        scope: bridgeActionScope,
        action: "vetoSteward",
        args: { subjectId: "steward-bad", subjectKind: "steward", reason: "misconduct" }
      }
    );
    expect(plan.decision.action).toBe("vetoSteward");
    expect(plan.contractCalls[0]?.functionName).toBe("vetoSteward");
  });

  it("a steward:steward:* wildcard also authorizes vetoSteward", async () => {
    const bridge = makeBridge();
    const plan = await bridge.callAction(callerWith([bridgeActionScope, "steward:steward:*"]), {
      scope: bridgeActionScope,
      action: "vetoSteward",
      args: { subjectId: "steward-bad", subjectKind: "steward", reason: "misconduct" }
    });
    expect(plan.decision.action).toBe("vetoSteward");
  });

  it("a granular scope for a DIFFERENT action does not authorize vetoSteward", async () => {
    const bridge = makeBridge();
    await expect(
      bridge.callAction(callerWith([bridgeActionScope, "steward:subject:annotate"]), {
        scope: bridgeActionScope,
        action: "vetoSteward",
        args: { subjectId: "steward-bad", subjectKind: "steward", reason: "misconduct" }
      })
    ).rejects.toBeInstanceOf(LiveStreakCapabilityError);
  });
});
