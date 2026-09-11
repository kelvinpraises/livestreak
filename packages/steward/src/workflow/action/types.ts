// --- exports ---

export interface StewardActionContext {
  readonly stewardId?: string;
  readonly targetStewardId?: string;
  readonly forumThreadId?: string;
  readonly proposalId?: string;
  // The on-chain Vault.Outcome enum value (YES = 1, NO = 2) for a `resolve` action.
  readonly resolveOutcome?: number;
}
