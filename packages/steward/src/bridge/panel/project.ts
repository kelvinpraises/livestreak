import type { StewardDecisionAction } from "../../model/decision.js";
import { actionScopeFor } from "../action-scope.js";
import type { StewardFinding, StewardFindingKind } from "../../model/finding.js";
import type { StewardPanelView } from "../../model/panel.js";
import type { StewardSubject, StewardSubjectKind } from "../../model/subject.js";
import type {
  StewardControlsView,
  StewardFunctionTarget,
  StewardFunctionView,
  StewardPanelInput,
  StewardStateSnapshot
} from "./types.js";

// --- exports ---

export const projectStewardPanel = (stateOrSnapshot: StewardPanelInput): StewardPanelView => {
  const pending = readPendingPlans(stateOrSnapshot);
  const decisions = readDecisions(stateOrSnapshot);

  return {
    runtimeId: stateOrSnapshot.runtimeId,
    ...("revision" in stateOrSnapshot && stateOrSnapshot.revision !== undefined
      ? { revision: stateOrSnapshot.revision }
      : {}),
    watchedSubjects: [...stateOrSnapshot.watchedSubjects],
    latestFindings: [...stateOrSnapshot.latestFindings],
    ...(decisions.length > 0 ? { latestDecision: decisions[decisions.length - 1] } : {}),
    ...(pending.length > 0 ? { pendingActionPlan: pending[0] } : {}),
    ...(stateOrSnapshot.lastError === undefined ? {} : { lastError: stateOrSnapshot.lastError }),
    ...(stateOrSnapshot.updatedAtMs === undefined
      ? {}
      : { updatedAtMs: stateOrSnapshot.updatedAtMs }),
    summary: {
      watchedSubjectCount: stateOrSnapshot.watchedSubjects.length,
      findingCount: stateOrSnapshot.latestFindings.length,
      pendingPlanCount: pending.length,
      criticalFindingCount: stateOrSnapshot.latestFindings.filter(
        (finding) => finding.severity === "critical"
      ).length
    }
  };
};

export const projectStewardFunctions = (
  snapshot: StewardStateSnapshot | StewardPanelView
): StewardFunctionView[] => {
  const findings = [...snapshot.latestFindings];
  const functions: StewardFunctionView[] = [];

  for (const subject of snapshot.watchedSubjects) {
    const subjectFindings = findings.filter((finding) => finding.subject.id === subject.id);
    for (const entry of CATALOG) {
      functions.push(projectCatalogEntry(entry, subject, subjectFindings));
    }
  }

  return functions;
};

export const projectStewardControls = (
  snapshot: StewardStateSnapshot,
  revision: number
): StewardControlsView => ({
  runtimeId: snapshot.runtimeId,
  revision,
  functions: projectStewardFunctions(snapshot)
});

// --- helpers ---

type CatalogEntry = {
  readonly name: StewardDecisionAction;
  readonly scope: string;
  readonly label: string;
  readonly input?: string;
  readonly targetKind: StewardFunctionTarget["kind"];
};

const CATALOG: readonly CatalogEntry[] = [
  {
    name: "ignore",
    scope: "steward:subject:ignore",
    label: "Ignore",
    targetKind: "subject"
  },
  {
    name: "annotate",
    scope: "steward:subject:annotate",
    label: "Annotate",
    input: "AnnotateInput",
    targetKind: "subject"
  },
  {
    name: "openThread",
    scope: "steward:subject:openThread",
    label: "Open thread",
    input: "OpenThreadInput",
    targetKind: "subject"
  },
  {
    name: "triggerHot",
    scope: "steward:vault:triggerHot",
    label: "Trigger hot",
    input: "TriggerHotInput",
    targetKind: "vault"
  },
  {
    name: "challenge",
    scope: "steward:proposal:challenge",
    label: "Challenge proposal",
    input: "ChallengeInput",
    targetKind: "subject"
  },
  {
    name: "resolve",
    scope: "steward:vault:resolve",
    label: "Resolve vault",
    input: "ResolveInput",
    targetKind: "vault"
  },
  {
    name: "proposePenalty",
    scope: "steward:steward:proposePenalty",
    label: "Propose penalty",
    input: "ProposePenaltyInput",
    targetKind: "steward"
  },
  {
    name: "vetoSteward",
    scope: "steward:steward:vetoSteward",
    label: "Veto steward",
    input: "VetoStewardInput",
    targetKind: "steward"
  },
  {
    name: "challengeStewardDecision",
    scope: "steward:steward:challengeStewardDecision",
    label: "Challenge steward decision",
    input: "ChallengeStewardDecisionInput",
    targetKind: "steward"
  }
];

const projectCatalogEntry = (
  entry: CatalogEntry,
  subject: StewardSubject,
  subjectFindings: readonly StewardFinding[]
): StewardFunctionView => {
  const target = buildTarget(entry, subject, subjectFindings);
  const disabledReason = disabledReasonFor(entry.name, subject, subjectFindings);

  return disabledReason === undefined
    ? enabledFunction(entry, target)
    : disabledFunction(entry, target, disabledReason);
};

const buildTarget = (
  entry: CatalogEntry,
  subject: StewardSubject,
  subjectFindings: readonly StewardFinding[]
): StewardFunctionTarget => {
  const base = {
    subjectId: subject.id,
    subjectKind: subject.kind,
    ...(subjectFindings[0] === undefined ? {} : { findingId: subjectFindings[0].id })
  };

  switch (entry.targetKind) {
    case "vault":
      return {
        kind: "vault",
        ...base,
        ...(subject.vaultId === undefined ? {} : { vaultId: subject.vaultId })
      };
    case "steward":
      return {
        kind: "steward",
        ...base,
        stewardId: subject.kind === "steward" ? subject.id : undefined
      };
    case "global":
      return { kind: "global" };
    case "subject":
      return { kind: "subject", ...base };
  }
};

const disabledReasonFor = (
  action: StewardDecisionAction,
  subject: StewardSubject,
  subjectFindings: readonly StewardFinding[]
): string | undefined => {
  switch (action) {
    case "triggerHot":
    case "resolve":
      if (subject.vaultId === undefined) {
        return "Subject is not a vault";
      }
      break;
    case "vetoSteward":
    case "proposePenalty":
    case "challengeStewardDecision":
      if (subject.kind !== "steward") {
        return "Subject is not a steward";
      }
      break;
    default:
      break;
  }

  if (action === "triggerHot" && !hasFindingKind(subjectFindings, "market_hot")) {
    return "No hot or risk finding for this subject";
  }

  if (action === "resolve" && !hasFindingKind(subjectFindings, "bad_resolution")) {
    return "No resolution-related finding for this subject";
  }

  return undefined;
};

const hasFindingKind = (
  findings: readonly StewardFinding[],
  kind: StewardFindingKind
): boolean => findings.some((finding) => finding.kind === kind);

const enabledFunction = (
  entry: CatalogEntry,
  target: StewardFunctionTarget
): StewardFunctionView => ({
  name: entry.name,
  scope: actionScopeFor(entry.name) ?? entry.scope,
  label: entry.label,
  ...(entry.input === undefined ? {} : { input: entry.input }),
  target,
  disabled: false
});

const disabledFunction = (
  entry: CatalogEntry,
  target: StewardFunctionTarget,
  disabledReason: string
): StewardFunctionView => ({
  name: entry.name,
  scope: actionScopeFor(entry.name) ?? entry.scope,
  label: entry.label,
  ...(entry.input === undefined ? {} : { input: entry.input }),
  target,
  disabled: true,
  disabledReason
});

const readPendingPlans = (input: StewardPanelInput) => {
  if ("pendingActionPlans" in input && input.pendingActionPlans !== undefined) {
    return [...input.pendingActionPlans];
  }

  if ("pendingActionPlan" in input && input.pendingActionPlan !== undefined) {
    return [input.pendingActionPlan];
  }

  return [];
};

const readDecisions = (input: StewardPanelInput) => {
  if ("latestDecisions" in input && input.latestDecisions !== undefined) {
    return [...input.latestDecisions];
  }

  if ("latestDecision" in input && input.latestDecision !== undefined) {
    return [input.latestDecision];
  }

  return [];
};
