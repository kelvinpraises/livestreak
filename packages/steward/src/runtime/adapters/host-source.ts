import type { HostProviderDescriptor } from "@livestreak/host";
import type { StewardSubject } from "../../model/subject.js";
import type { HostFactSource } from "../sources.js";
import type { StewardFact } from "../../workflow/facts/fact.js";
import { buildStewardFact } from "./fact.js";

// --- Host fact source (WAVE 5 BUILD) ---
//
// Consumes the `@livestreak/host` provider surface (descriptor + per-subject host reads — cache-receipt
// counts, forum/annotation state). The host/executor injects a `HostFactReader` backed by the real host
// HTTP client; this adapter stamps `source:"host"` facts. We consume the host's `HostProviderDescriptor`
// type directly (no reimplementation).

export interface HostSubjectFact {
  readonly key: string;
  readonly value: unknown;
  readonly evidenceRefs?: readonly string[];
  readonly observedAtMs?: number;
}

export interface HostFactReader {
  // Per-subject host facts (e.g. cache receipt counts, forum thread/annotation presence).
  readonly readSubjectFacts: (subject: StewardSubject) => Promise<readonly HostSubjectFact[]>;
  // Optional host capability descriptor → a single `host:provider` capability fact.
  readonly readDescriptor?: () => Promise<HostProviderDescriptor>;
}

export const createHostFactSource = (reader: HostFactReader): HostFactSource => ({
  readFacts: async (subject: StewardSubject): Promise<readonly StewardFact[]> => {
    const facts: StewardFact[] = [];

    if (reader.readDescriptor !== undefined) {
      const descriptor = await reader.readDescriptor();
      facts.push(
        buildStewardFact("host", {
          subject,
          key: "host:provider",
          value: { hostId: descriptor.hostId, modules: [...descriptor.modules] }
        })
      );
    }

    for (const fact of await reader.readSubjectFacts(subject)) {
      facts.push(
        buildStewardFact("host", {
          subject,
          key: fact.key,
          value: fact.value,
          ...(fact.evidenceRefs === undefined ? {} : { evidenceRefs: fact.evidenceRefs }),
          ...(fact.observedAtMs === undefined ? {} : { observedAtMs: fact.observedAtMs })
        })
      );
    }

    return facts;
  }
});
