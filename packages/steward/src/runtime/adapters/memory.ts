import type { StewardSubject } from "../../model/subject.js";
import type { MemoryFactSource } from "../sources.js";
import type { StewardMemoryRememberInput, StewardMemorySink } from "../sink.js";
import type { StewardFact } from "../../workflow/facts/fact.js";
import { buildStewardFact } from "./fact.js";

// --- Memory fact source + sink (WAVE 5 BUILD) ---
//
// The durable-memory leg. Backed by Walrus **MemWal** via the host/wallet path (the host owns the MemWal
// account + Sui owner wiring; the executor injects a `MemWalMemory` client here). `recall` becomes
// `source:"memory"` facts; `remember` persists a subject's findings/decisions. We never import
// `@mysten-incubation/memwal` directly — the client is injected, so the SDK ownership stays with the
// host/wallet layer.

export interface MemoryRecord {
  readonly key: string;
  readonly value: unknown;
  readonly evidenceRefs?: readonly string[];
  readonly observedAtMs?: number;
}

export interface MemWalRememberRecord {
  readonly subject: StewardSubject;
  readonly findingIds: readonly string[];
  readonly decisionActions: readonly string[];
  readonly atMs: number;
}

export interface MemWalMemory {
  readonly recall: (subject: StewardSubject) => Promise<readonly MemoryRecord[]>;
  readonly remember: (record: MemWalRememberRecord) => Promise<void> | void;
}

export const createMemoryFactSource = (memory: MemWalMemory): MemoryFactSource => ({
  readFacts: async (subject: StewardSubject): Promise<readonly StewardFact[]> => {
    const records = await memory.recall(subject);
    return records.map((record) =>
      buildStewardFact("memory", {
        subject,
        key: record.key,
        value: record.value,
        ...(record.evidenceRefs === undefined ? {} : { evidenceRefs: record.evidenceRefs }),
        ...(record.observedAtMs === undefined ? {} : { observedAtMs: record.observedAtMs })
      })
    );
  }
});

export const createMemorySink = (memory: MemWalMemory): StewardMemorySink => ({
  remember: async (input: StewardMemoryRememberInput): Promise<void> => {
    await memory.remember({
      subject: input.subject,
      findingIds: input.findings.map((finding) => finding.id),
      decisionActions: input.decisions.map((decision) => decision.action),
      atMs: Date.now()
    });
  }
});
