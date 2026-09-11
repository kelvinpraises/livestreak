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
              args: [subject.vaultId, decision.reason]
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
      return subject.vaultId === undefined
        ? []
        : [
            {
              contract: "vault",
              functionName: "resolve",
              // YES = 1 by default if the caller did not specify an outcome.
              args: [subject.vaultId, actionContext.resolveOutcome ?? 1]
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
    case "resolve":
      // S4: a triggerHot/resolve whose subject has no vaultId cannot emit a contract call. Instead of
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
    case "challenge":
    case "proposePenalty":
    case "vetoSteward":
      return [];
  }
};
