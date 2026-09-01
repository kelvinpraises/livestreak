import type { StewardFinding } from "./finding.js";

// --- exports ---

export type StewardDecisionAction =
  | "ignore"
  | "annotate"
  | "openThread"
  | "triggerHot"
  | "challenge"
  | "resolve"
  | "proposePenalty"
  | "vetoSteward"
  | "challengeStewardDecision";

export interface StewardDecision {
  readonly action: StewardDecisionAction;
  readonly finding: StewardFinding;
  readonly reason: string;
  readonly decidedAtMs?: number;
}
