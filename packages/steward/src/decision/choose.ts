import type { StewardDecision } from "../model/decision.js";
import type { StewardFinding } from "../model/finding.js";
import type { StewardDecisionMapping, StewardDecisionPolicy } from "./types.js";

// --- exports ---

export const chooseStewardDecisions = (
  findings: readonly StewardFinding[],
  policy: StewardDecisionPolicy
): StewardDecision[] => findings.map((finding) => chooseDecision(finding, policy));

// --- helpers ---

const chooseDecision = (
  finding: StewardFinding,
  policy: StewardDecisionPolicy
): StewardDecision => {
  const mapping = findMapping(finding, policy);

  return {
    action: mapping?.action ?? policy.defaultAction ?? "ignore",
    finding,
    reason: mapping?.reason ?? policy.defaultReason ?? "no policy mapping matched"
  };
};

const findMapping = (
  finding: StewardFinding,
  policy: StewardDecisionPolicy
): StewardDecisionMapping | undefined =>
  policy.mappings.find(
    (mapping) =>
      mapping.findingKind === finding.kind &&
      (mapping.severity === undefined || mapping.severity === finding.severity)
  );
