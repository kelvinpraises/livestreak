import type {
  StewardActionPlan,
  StewardContractCall,
  StewardHostAction
} from "../../model/action-plan.js";
import type { StewardDecision } from "../../model/decision.js";
import type { StewardActionContext } from "./types.js";

// --- exports ---

export const planStewardActions = (
  decisions: readonly StewardDecision[],
  actionContext: StewardActionContext = {}
): StewardActionPlan[] => decisions.map((decision) => planStewardAction(decision, actionContext));

// --- helpers ---

const planStewardAction = (
  decision: StewardDecision,
  actionContext: StewardActionContext
): StewardActionPlan => ({
  decision,
  contractCalls: contractCallsForDecision(decision, actionContext),
  hostActions: hostActionsForDecision(decision, actionContext)
});

const contractCallsForDecision = (
  decision: StewardDecision,
  actionContext: StewardActionContext
): readonly StewardContractCall[] => {
  const subject = decision.finding.subject;

  switch (decision.action) {
    case "ignore":
    case "annotate":
    case "openThread":
      return [];
    case "triggerHot":
      return subject.vaultId === undefined
        ? []
        : [
            {
              contract: "vault",
              functionName: "triggerHot",
              args: [subject.vaultId, decision.reason, decision.finding.severity]
            }
          ];
    case "challenge":
      return [
        {
          contract: "stewardRegistry",
          functionName: "challengeProposal",
          args: [actionContext.proposalId ?? subject.id, 0]
        }
      ];
    case "resolve":
      if (subject.vaultId === undefined) {
        return [];
      }
      // No default outcome: missing/invalid resolveOutcome plans zero calls;
      // the attention annotate below makes the no-op auditable.
      if (actionContext.resolveOutcome !== 1 && actionContext.resolveOutcome !== 2) {
        return [];
      }
      return [
        {
          contract: "vault",
          functionName: "resolve",
          args: [subject.vaultId, actionContext.resolveOutcome]
        }
      ];
    case "proposePenalty":
      return [
        {
          contract: "stewardRegistry",
          functionName: "proposePenalty",
          args: [actionContext.targetStewardId ?? subject.id, decision.reason]
        }
      ];
    case "vetoSteward":
      return [
        {
          contract: "stewardRegistry",
          functionName: "vetoSteward",
          args: [actionContext.targetStewardId ?? subject.id, decision.reason]
        }
      ];
    case "challengeStewardDecision":
      return [
        {
          contract: "stewardRegistry",
          functionName: "challengeStewardDecision",
          args: [actionContext.targetStewardId ?? subject.id, decision.finding.id, decision.reason]
        }
      ];
  }
};

const hostActionsForDecision = (
  decision: StewardDecision,
  actionContext: StewardActionContext
): readonly StewardHostAction[] => {
  const subject = decision.finding.subject;

  switch (decision.action) {
    case "ignore":
      return [];
    case "annotate":
      return [
        {
          kind: "annotate",
          payload: {
            subject,
            message: decision.reason,
            findingId: decision.finding.id
          }
        }
      ];
    case "openThread":
      return [
        {
          kind: "openThread",
          payload: {
            subject,
            title: decision.finding.message,
            stewardId: actionContext.stewardId
          }
        }
      ];
    case "challengeStewardDecision":
      return [
        {
          kind: "appendMessage",
          payload: {
            threadId: actionContext.forumThreadId,
            subject,
            message: decision.reason,
            findingId: decision.finding.id
          }
        }
      ];
    case "triggerHot":
      // S4: a triggerHot whose subject has no vaultId cannot emit a contract call. Instead of
      // a SILENT empty plan, surface a visible annotate signal so the no-op is auditable on the board.
      return subject.vaultId === undefined
        ? [
            {
              kind: "annotate",
              payload: {
                subject,
                message: `Cannot ${decision.action}: subject has no vaultId — ${decision.reason}`,
                findingId: decision.finding.id
              }
            }
          ]
        : [];
    case "resolve":
      if (subject.vaultId === undefined) {
        return [
          {
            kind: "annotate",
            payload: {
              subject,
              message: `Cannot resolve: subject has no vaultId — ${decision.reason}`,
              findingId: decision.finding.id
            }
          }
        ];
      }
      if (actionContext.resolveOutcome !== 1 && actionContext.resolveOutcome !== 2) {
        return [
          {
            kind: "annotate",
            payload: {
              subject,
              message: `Cannot resolve: missing-outcome — ${decision.reason}`,
              findingId: decision.finding.id
            }
          }
        ];
      }
      return [];
    case "challenge":
    case "proposePenalty":
    case "vetoSteward":
      return [];
  }
};
