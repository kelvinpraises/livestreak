import type { StewardDecision } from "./decision.js";
import type { StewardFindingSeverity } from "./finding.js";
import type { StewardSubject } from "./subject.js";

// --- exports ---

export interface StewardActionPlan {
  readonly decision: StewardDecision;
  readonly contractCalls: readonly StewardContractCall[];
  readonly hostActions: readonly StewardHostAction[];
}

export type StewardContractCall =
  | {
      readonly contract: "vault";
      readonly functionName: "triggerHot";
      // Severity rides the call so the executor maps it onto the on-chain enum (Warm/Hot/Critical)
      // instead of guessing; the reason is hashed at the executor boundary (reasonHash on-chain).
      readonly args: readonly [vaultId: string, reason: string, severity: StewardFindingSeverity];
    }
  | {
      readonly contract: "vault";
      readonly functionName: "resolve";
      // outcome: the on-chain Vault.Outcome enum value (YES = 1, NO = 2).
      readonly args: readonly [vaultId: string, outcome: number];
    }
  | {
      readonly contract: "stewardRegistry";
      readonly functionName: "challengeProposal";
      readonly args: readonly [proposalId: string, sideOrCode: number];
    }
  | {
      readonly contract: "stewardRegistry";
      readonly functionName: "proposePenalty";
      readonly args: readonly [stewardId: string, reason: string];
    }
  | {
      readonly contract: "stewardRegistry";
      readonly functionName: "vetoSteward";
      readonly args: readonly [stewardId: string, reason: string];
    }
  | {
      readonly contract: "stewardRegistry";
      readonly functionName: "challengeStewardDecision";
      readonly args: readonly [stewardId: string, findingId: string, reason: string];
    };

export interface OpenThreadPayload {
  readonly subject: StewardSubject;
  readonly title: string;
  readonly stewardId?: string;
  readonly findingId?: string;
}

export interface AppendMessagePayload {
  readonly subject: StewardSubject;
  readonly message: string;
  readonly findingId?: string;
  readonly threadId?: string;
  readonly stewardId?: string;
}

export interface AnnotationPayload {
  readonly subject: StewardSubject;
  readonly message: string;
  readonly findingId: string;
  readonly stewardId?: string;
}

export type StewardHostAction =
  | { readonly kind: "openThread"; readonly payload: OpenThreadPayload }
  | { readonly kind: "appendMessage"; readonly payload: AppendMessagePayload }
  | { readonly kind: "annotate"; readonly payload: AnnotationPayload };
