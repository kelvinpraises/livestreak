import { describe, expect, it, vi } from "vitest";

import { createStewardRuntime } from "../src/runtime/runtime.js";
import {
  makeFakeContractFactSource,
  makeFakeHostFactSource,
  makeFakeObserveFactSource,
  makeRecordingActionPlanSink
} from "./fakes/runtime-sources.js";

const subject = {
  kind: "vault" as const,
  id: "vault-1",
  marketId: "market-1",
  vaultId: "vault-1"
};

const ruleset = {
  id: "vault-health",
  rules: [
    {
      id: "missing-cache",
      findingKind: "missing_evidence" as const,
      condition: { type: "fact_equals" as const, key: "cache_receipt_count", value: 0 },
      severity: "warning" as const,
      message: "Cache receipt missing"
    }
  ]
};

const decisionPolicy = {
  id: "default-policy",
  mappings: [
    {
      findingKind: "missing_evidence" as const,
      action: "openThread" as const,
      reason: "Discuss missing cache evidence"
    }
  ]
};

const baseConfig = {
  runtimeId: "runtime-1",
  watchedSubjects: [subject],
  ruleset,
  decisionPolicy,
  actionContext: { stewardId: "steward-1" }
};

describe("steward runtime", () => {
  it("runs subject through facts, findings, decisions, action plans, and sink", async () => {
    const sink = makeRecordingActionPlanSink();
    const runtime = createStewardRuntime({
      config: baseConfig,
      contractFactSource: makeFakeContractFactSource({}),
      hostFactSource: makeFakeHostFactSource({
        "vault-1": [
          {
            id: "fact-cache",
            subject,
            source: "host",
            key: "cache_receipt_count",
            value: 0,
            observedAtMs: 200
          }
        ]
      }),
      observeFactSource: makeFakeObserveFactSource({}),
      actionPlanSink: sink
    });

    const snapshot = await runtime.refresh();

    expect(snapshot.latestFindings).toHaveLength(1);
    expect(snapshot.latestDecisions?.[0]?.action).toBe("openThread");
    expect(sink.plans).toHaveLength(1);
    expect(sink.plans[0]?.hostActions[0]?.kind).toBe("openThread");
    expect(runtime.readPanel().summary?.findingCount).toBe(1);
  });

  it("produces no findings or plans when all fact sources return empty", async () => {
    const sink = makeRecordingActionPlanSink();
    const runtime = createStewardRuntime({
      config: baseConfig,
      contractFactSource: makeFakeContractFactSource({}),
      hostFactSource: makeFakeHostFactSource({}),
      observeFactSource: makeFakeObserveFactSource({}),
      actionPlanSink: sink
    });

    const snapshot = await runtime.refresh();

    expect(snapshot.latestFindings).toEqual([]);
    expect(snapshot.latestDecisions).toEqual([]);
    expect(sink.plans).toEqual([]);
  });

  it("notifies subscribers when the snapshot changes", async () => {
    const sink = makeRecordingActionPlanSink();
    const runtime = createStewardRuntime({
      config: baseConfig,
      contractFactSource: makeFakeContractFactSource({}),
      hostFactSource: makeFakeHostFactSource({
        "vault-1": [
          {
            id: "fact-cache",
            subject,
            source: "host",
            key: "cache_receipt_count",
            value: 0
          }
        ]
      }),
      observeFactSource: makeFakeObserveFactSource({}),
      actionPlanSink: sink
    });

    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(listener);

    await runtime.refresh();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]?.latestFindings).toHaveLength(1);

    unsubscribe();
    await runtime.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("starts polling only when refreshIntervalMs is configured", async () => {
    const sink = makeRecordingActionPlanSink();
    const runtime = createStewardRuntime({
      config: { ...baseConfig, refreshIntervalMs: 50 },
      contractFactSource: makeFakeContractFactSource({}),
      hostFactSource: makeFakeHostFactSource({}),
      observeFactSource: makeFakeObserveFactSource({}),
      actionPlanSink: sink
    });

    const polling = runtime.startPolling();

    await new Promise((resolve) => setTimeout(resolve, 120));
    polling.stop();

    expect(runtime.readSnapshot().watchedSubjects).toHaveLength(1);
  });
});
