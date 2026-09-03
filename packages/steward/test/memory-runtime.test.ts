import { LiveStreakConfigError } from "@livestreak/core";
import { describe, expect, it, vi } from "vitest";

import { refreshWatchedSubjects } from "../src/runtime/refresh.js";
import { createStewardRuntime } from "../src/runtime/runtime.js";
import {
  makeFakeContractFactSource,
  makeFakeHostFactSource,
  makeFakeMemoryFactSource,
  makeFakeObserveFactSource,
  makeRecordingActionPlanSink,
  makeRecordingMemorySink
} from "./fakes/runtime-sources.js";

const subject = {
  kind: "vault" as const,
  id: "vault-1",
  marketId: "market-1",
  vaultId: "vault-1"
};

const memoryAwareRuleset = {
  id: "bookmaker-trust",
  rules: [
    {
      id: "prior-bookmaker-flag",
      findingKind: "rogue_bookmaker" as const,
      condition: { type: "fact_truthy" as const, key: "prior_bookmaker_flag" },
      severity: "critical" as const,
      message: "Bookmaker previously flagged in market memory"
    }
  ]
};

const memoryAwareDecisionPolicy = {
  id: "bookmaker-policy",
  mappings: [
    {
      findingKind: "rogue_bookmaker" as const,
      action: "annotate" as const,
      reason: "Escalate repeat bookmaker concern from memory"
    }
  ]
};

const priorMemoryFact = {
  id: "fact-memory-prior",
  subject,
  source: "memory" as const,
  key: "prior_bookmaker_flag",
  value: true,
  observedAtMs: 100
};

const emptySources = () => ({
  contract: makeFakeContractFactSource({}),
  host: makeFakeHostFactSource({}),
  observe: makeFakeObserveFactSource({}),
  memory: makeFakeMemoryFactSource({})
});

describe("steward memory ports", () => {
  it("recall changes the outcome when prior memory supplies a triggering fact", async () => {
    const withoutMemory = await refreshWatchedSubjects({
      watchedSubjects: [subject],
      ruleset: memoryAwareRuleset,
      decisionPolicy: memoryAwareDecisionPolicy,
      sources: emptySources()
    });

    const withMemory = await refreshWatchedSubjects({
      watchedSubjects: [subject],
      ruleset: memoryAwareRuleset,
      decisionPolicy: memoryAwareDecisionPolicy,
      sources: {
        ...emptySources(),
        memory: makeFakeMemoryFactSource({ "vault-1": [priorMemoryFact] })
      }
    });

    expect(withoutMemory.latestFindings).toHaveLength(0);
    expect(withoutMemory.latestDecisions).toHaveLength(0);
    expect(withMemory.latestFindings).toHaveLength(1);
    expect(withMemory.latestFindings[0]?.kind).toBe("rogue_bookmaker");
    expect(withMemory.latestDecisions[0]?.action).toBe("annotate");
  });

  it("calls remember with subject findings and decisions after the pipeline runs", async () => {
    const actionSink = makeRecordingActionPlanSink();
    const memorySink = makeRecordingMemorySink();
    const submitSpy = vi.spyOn(actionSink, "submit");
    const rememberSpy = vi.spyOn(memorySink, "remember");

    const runtime = createStewardRuntime({
      config: {
        runtimeId: "runtime-memory",
        watchedSubjects: [subject],
        ruleset: memoryAwareRuleset,
        decisionPolicy: memoryAwareDecisionPolicy,
        actionContext: { stewardId: "steward-1" }
      },
      contractFactSource: makeFakeContractFactSource({}),
      hostFactSource: makeFakeHostFactSource({}),
      observeFactSource: makeFakeObserveFactSource({}),
      memoryFactSource: makeFakeMemoryFactSource({ "vault-1": [priorMemoryFact] }),
      actionPlanSink: actionSink,
      memorySink
    });

    await runtime.refresh();

    expect(rememberSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(rememberSpy.mock.invocationCallOrder[0]).toBeLessThan(submitSpy.mock.invocationCallOrder[0]!);

    const remembered = memorySink.remembered[0]!;
    expect(remembered.subject).toEqual(subject);
    expect(remembered.findings).toHaveLength(1);
    expect(remembered.findings[0]?.kind).toBe("rogue_bookmaker");
    expect(remembered.decisions).toHaveLength(1);
    expect(remembered.decisions[0]?.action).toBe("annotate");
  });

  it("rejects malformed recalled memories during fact validation", async () => {
    await expect(
      refreshWatchedSubjects({
        watchedSubjects: [subject],
        ruleset: memoryAwareRuleset,
        decisionPolicy: memoryAwareDecisionPolicy,
        sources: {
          ...emptySources(),
          memory: makeFakeMemoryFactSource({
            "vault-1": [
              {
                id: "bad-memory",
                subject,
                source: "forum",
                key: "prior_bookmaker_flag",
                value: true
              }
            ]
          })
        }
      })
    ).rejects.toBeInstanceOf(LiveStreakConfigError);
  });

  it("accepts memory-sourced facts with source memory", () => {
    expect(priorMemoryFact.source).toBe("memory");
  });
});
