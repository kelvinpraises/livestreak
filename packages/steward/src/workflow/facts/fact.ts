import type { StewardSubject } from "../../model/subject.js";
import type { TeeAttestationRef } from "./tee.js";

// --- exports ---

export const STEWARD_FACT_SOURCES = ["contract", "host", "observe", "memory"] as const;

export type StewardFactSource = (typeof STEWARD_FACT_SOURCES)[number];

export interface StewardFact {
  readonly id: string;
  readonly subject: StewardSubject;
  readonly source: StewardFactSource;
  readonly key: string;
  readonly value: unknown;
  readonly evidenceRefs?: readonly string[];
  readonly attestationRef?: TeeAttestationRef;
  readonly observedAtMs?: number;
}
