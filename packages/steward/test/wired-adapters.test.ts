import { describe, expect, it } from "vitest";

import { createStewardRuntime } from "../src/runtime/runtime.js";
import {
  createActionPlanSink,
  createContractFactSource,
  createHostFactSource,
  createMemoryFactSource,
  createMemorySink,
  createObserveFactSource,
  type MemWalMemory,
  type MemWalRememberRecord
} from "../src/runtime/adapters/index.js";
import type { StewardContractCall } from "../src/model/action-plan.js";

const vaultSubject = {
  kind: "vault" as const,
  id: "vault-1",
  marketId: "market-1",
  vaultId: "vault-1"
};

const config = {
  runtimeId: "runtime-wired",
  watchedSubjects: [vaultSubject],
  ruleset: {
    id: "vault-health",
    rules: [
      {
        id: "hot",
        findingKind: "market_hot" as const,
        condition: { type: "fact_truthy" as const, key: "vault_hot" },
        severity: "critical" as const,
        message: "Vault is hot"
      }
    ]
  },
  decisionPolicy: {
    id: "default",
    mappings: [
      { findingKind: "market_hot" as const, action: "triggerHot" as const, reason: "Escalate hot vault" }
    ]
  },
  actionContext: { stewardId: "steward-1" }
};

// In-memory MemWal stand-in (the real adapter is injected the host/wallet MemWal client).
const makeMemory = () => {
  const remembered: MemWalRememberRecord[] = [];
  const memory: MemWalMemory = {
    recall: async () => [],
    remember: (record) => {
      remembered.push(record);
    }
  };
  return { memory, remembered };
};

describe("steward runtime wired through the REAL injected-port adapters", () => {
  it("ingests a contract fact → finding → decision → dispatches a triggerHot action plan", async () => {
    const dispatched: StewardContractCall[] = [];
    const { memory, remembered } = makeMemory();

    const runtime = createStewardRuntime({
      config,
      // Contract fact source backed by an injected per-chain vault reader (EVM here).
      contractFactSource: createContractFactSource({
        chain: "evm",
        readVaultFacts: async () => [{ key: "vault_hot", value: true, evidenceRefs: ["0xabc"] }]
      }),
      hostFactSource: createHostFactSource({ readSubjectFacts: async () => [] }),
      observeFactSource: createObserveFactSource({ readBoard: async () => null }),
      memoryFactSource: createMemoryFactSource(memory),
      memorySink: createMemorySink(memory),
      actionPlanSink: createActionPlanSink({
        contract: {
          chain: "evm",
          executeContractCall: async (call) => {
            dispatched.push(call);
            return { txId: "0xdeadbeef" };
          }
        },
        host: { runHostAction: () => {} }
      })
    });

    const snapshot = await runtime.refresh();

    expect(snapshot.latestFindings).toHaveLength(1);
    expect(snapshot.latestFindings[0]?.kind).toBe("market_hot");
    expect(snapshot.latestDecisions?.[0]?.action).toBe("triggerHot");

    // The wired action-plan sink dispatched the on-chain triggerHot via the injected executor.
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.functionName).toBe("triggerHot");
    expect(dispatched[0]?.args[0]).toBe("vault-1");

    // The wired memory sink persisted the subject's finding via the MemWal client.
    expect(remembered).toHaveLength(1);
    expect(remembered[0]?.findingIds).toHaveLength(1);
  });

  it("poll cycle runs the wired pipeline repeatedly", async () => {
    let calls = 0;
    const { memory } = makeMemory();
    const runtime = createStewardRuntime({
      config: { ...config, refreshIntervalMs: 30 },
      contractFactSource: createContractFactSource({
        chain: "evm",
        readVaultFacts: async () => {
          calls += 1;
          return [{ key: "vault_hot", value: true }];
        }
      }),
      hostFactSource: createHostFactSource({ readSubjectFacts: async () => [] }),
      observeFactSource: createObserveFactSource({ readBoard: async () => null }),
      memoryFactSource: createMemoryFactSource(memory),
      memorySink: createMemorySink(memory),
      actionPlanSink: createActionPlanSink({
        contract: { chain: "evm", executeContractCall: async () => ({ txId: "0x1" }) },
        host: { runHostAction: () => {} }
      })
    });

    const polling = runtime.startPolling();
    await new Promise((resolve) => setTimeout(resolve, 100));
    polling.stop();

    expect(calls).toBeGreaterThan(0);
  });
});
