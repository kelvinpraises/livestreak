import type { TeeAttestationRef } from "../workflow/facts/tee.js";
import type { StewardSubject } from "./subject.js";

// --- exports ---

export type StewardFindingKind =
  | "duplicate_vault"
  | "bad_evidence"
  | "missing_evidence"
  | "bad_resolution"
  | "rogue_observer"
  | "rogue_bookmaker"
  | "rogue_steward"
  | "market_hot"
  | "manual_note";

export type StewardFindingSeverity = "info" | "warning" | "critical";

export interface StewardFinding {
  readonly id: string;
  readonly kind: StewardFindingKind;
  readonly subject: StewardSubject;
  readonly severity: StewardFindingSeverity;
  readonly message: string;
  readonly evidenceRefs?: readonly string[];
  readonly createdAtMs?: number;
  readonly attestationRef?: TeeAttestationRef;
}
