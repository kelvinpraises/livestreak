import type { StewardDecisionAction } from "../model/decision.js";
import type { CapabilityScope } from "./types.js";

// --- Single source of truth: action → granular capability scope (S2) ---
//
// The bridge ADVERTISES these per-action scopes (panel/project CATALOG) and ENFORCES them
// (bridge.callAction). Keeping the map here means the advertised scope and the enforced scope can
// never drift — a caller holding only the broad `bridge:action` permission can no longer invoke a
// privileged action; it must hold the granular scope (or a matching `steward:<kind>:*` wildcard).

export const STEWARD_ACTION_SCOPES: Readonly<Record<StewardDecisionAction, CapabilityScope>> = {
  ignore: "steward:subject:ignore",
  annotate: "steward:subject:annotate",
  openThread: "steward:subject:openThread",
  triggerHot: "steward:vault:triggerHot",
  challenge: "steward:proposal:challenge",
  resolve: "steward:vault:resolve",
  proposePenalty: "steward:steward:proposePenalty",
  vetoSteward: "steward:steward:vetoSteward",
  challengeStewardDecision: "steward:steward:challengeStewardDecision"
};

export const actionScopeFor = (action: string): CapabilityScope | undefined =>
  (STEWARD_ACTION_SCOPES as Record<string, CapabilityScope>)[action];
