import type { StewardSubject } from "../../model/subject.js";
import type { MemoryFactSource } from "../sources.js";
import type { StewardMemoryRememberInput, StewardMemorySink } from "../sink.js";
import type { StewardFact } from "../../workflow/facts/fact.js";
import { buildStewardFact } from "./fact.js";

// --- Memory fact source + sink ---
//
// The durable-memory leg, storage-agnostic: the gateway injects a `StewardMemoryClient` (today an
// HTTP client over the host's DB-backed /memory/records; swappable for any store). `recall` becomes
// `source:"memory"` facts; `remember` persists a subject's findings/decisions.

export interface MemoryRecord {
  readonly key: string;
  readonly value: unknown;
  readonly evidenceRefs?: readonly string[];
  readonly observedAtMs?: number;
}

export interface StewardMemoryRememberRecord {
  readonly subject: StewardSubject;
  readonly findingIds: readonly string[];
  readonly decisionActions: readonly string[];
  readonly atMs: number;
}

export interface StewardMemoryClient {
  readonly recall: (subject: StewardSubject) => Promise<readonly MemoryRecord[]>;
  readonly remember: (record: StewardMemoryRememberRecord) => Promise<void> | void;
}

export const createMemoryFactSource = (memory: StewardMemoryClient): MemoryFactSource => ({
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

export const createMemorySink = (memory: StewardMemoryClient): StewardMemorySink => ({
  remember: async (input: StewardMemoryRememberInput): Promise<void> => {
    await memory.remember({
      subject: input.subject,
      findingIds: input.findings.map((finding) => finding.id),
      decisionActions: input.decisions.map((decision) => decision.action),
      atMs: Date.now()
    });
  }
});
