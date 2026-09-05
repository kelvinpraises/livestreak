import type { StewardFindingKind, StewardFindingSeverity } from "../../model/finding.js";

// --- exports ---

export type StewardRuleCondition =
  | { readonly type: "fact_present"; readonly key: string }
  | { readonly type: "fact_missing"; readonly key: string }
  | { readonly type: "fact_equals"; readonly key: string; readonly value: unknown }
  | { readonly type: "fact_truthy"; readonly key: string };

export interface StewardRule {
  readonly id: string;
  readonly findingKind: StewardFindingKind;
  readonly condition: StewardRuleCondition;
  readonly severity: StewardFindingSeverity;
  readonly message: string;
}

export interface StewardRuleset {
  readonly id: string;
  readonly rules: readonly StewardRule[];
}
