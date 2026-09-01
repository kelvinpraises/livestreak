import type { StewardDecisionAction } from "../model/decision.js";
import type { StewardFindingKind, StewardFindingSeverity } from "../model/finding.js";

// --- exports ---

export interface StewardDecisionMapping {
  readonly findingKind: StewardFindingKind;
  readonly severity?: StewardFindingSeverity;
  readonly action: StewardDecisionAction;
  readonly reason: string;
}

export interface StewardDecisionPolicy {
  readonly id: string;
  readonly mappings: readonly StewardDecisionMapping[];
  readonly defaultAction?: StewardDecisionAction;
  readonly defaultReason?: string;
}
