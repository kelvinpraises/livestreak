import type { StewardFactSource } from "../../workflow/facts/fact.js";
import type { StewardFact } from "../../workflow/facts/fact.js";
import type { StewardSubject } from "../../model/subject.js";

// --- Shared fact builder for the injected-port adapters (WAVE 5 BUILD) ---
//
// Every real adapter (contract/host/observe/memory) translates a domain read from the OWNING package
// into a canonical `StewardFact`. This builder stamps the `source`, scopes the fact id by the subject
// (kind+id, matching the S5 scoping rule) so facts from different subjects never collide, and drops
// empty `evidenceRefs` (the validator rejects an empty array).

export interface BuildFactInput {
  readonly subject: StewardSubject;
  readonly key: string;
  readonly value: unknown;
  readonly evidenceRefs?: readonly string[];
  readonly observedAtMs?: number;
}

export const buildStewardFact = (
  source: StewardFactSource,
  input: BuildFactInput
): StewardFact => {
  const refs = input.evidenceRefs?.filter((ref) => ref.trim().length > 0) ?? [];
  return {
    id: `${source}:${input.subject.kind}:${input.subject.id}:${input.key}`,
    subject: input.subject,
    source,
    key: input.key,
    value: input.value,
    ...(refs.length > 0 ? { evidenceRefs: refs } : {}),
    ...(input.observedAtMs === undefined ? {} : { observedAtMs: input.observedAtMs })
  };
};
