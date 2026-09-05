import { describe, expect, it } from "vitest";

import { createStewardRuntime } from "../src/runtime/runtime.js";
import {
  emptyMemoryPorts,
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

const baseConfig = {
  runtimeId: "runtime-last-error",
  watchedSubjects: [subject],
  ruleset: {
    id: "rules",
    rules: [
      {
        id: "always",
        findingKind: "manual_note" as const,
        condition: { type: "fact_present" as const, key: "any" },
        severity: "info" as const,
        message: "note"
      }
    ]
  },
  decisionPolicy: { id: "policy", mappings: [] }
};

describe("steward runtime lastError hygiene", () => {
  it("clears lastError after a successful refresh following a failure", async () => {
    const sink = makeRecordingActionPlanSink();
    let fail = true;
    const hostFactSource = {
      readFacts: async () => {
        if (fail) {
          throw new Error("host read failed");
        }
        return [
          {
            id: "fact-1",
            subject,
            source: "host",
            key: "any",
            value: true
          }
        ];
      }
    };

    const runtime = createStewardRuntime({
      config: baseConfig,
      contractFactSource: makeFakeContractFactSource({}),
      hostFactSource,
      observeFactSource: makeFakeObserveFactSource({}),
      ...emptyMemoryPorts(),
      actionPlanSink: sink
    });

    await expect(runtime.refresh()).rejects.toThrow("host read failed");
    expect(runtime.readSnapshot().lastError).toBe("host read failed");

    fail = false;
    await runtime.refresh();

    expect(runtime.readSnapshot().lastError).toBeUndefined();
  });
});
