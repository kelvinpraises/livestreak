import type { VaultMandate } from "@livestreak/schema";
import type { BookmakerDecision } from "./decision.js";
import type { VaultDraft } from "./vault-draft.js";

// --- exports ---

export type CreateVaultIntent = {
  readonly action: "createVault";
  readonly marketId: string;
  readonly question: string;
  readonly creatorSide: "yes" | "no";
  readonly creatorStake: bigint;
  readonly seedRate: bigint;
  readonly resolutionSource: string;
  readonly resolutionWindowExpiresAtMs: number;
  readonly mandate?: VaultMandate;
  readonly operationId?: string;
  readonly ruleHash?: string;
  readonly ruleVersion?: string;
};

export type JoinVaultIntent = {
  readonly action: "joinExistingVault";
  readonly marketId: string;
  readonly vaultId: string;
};

export type BookmakerWriteIntent = CreateVaultIntent | JoinVaultIntent;

export const buildCreateVaultIntent = (draft: VaultDraft): CreateVaultIntent => {
  const rule = (draft as { readonly ruleHash?: string }).ruleHash;
  return {
    action: "createVault",
    ...(draft.mandate === undefined ? {} : { mandate: draft.mandate, operationId: draft.operationId }),
    marketId: draft.marketId,
    question: draft.question,
    creatorSide: draft.creatorSide ?? "yes",
    creatorStake: draft.creatorStake!,
    seedRate: draft.seedRate!,
    resolutionSource: draft.resolutionSource,
    resolutionWindowExpiresAtMs: draft.resolutionWindow.expiresAtMs,
    ...(rule === undefined ? {} : { ruleHash: rule, ruleVersion: "livestreak-mandate/1" })
  };
};

// Inverse of buildCreateVaultIntent: the minimal honest VaultDraft an intent carries (the console
// path has no detection/evidence). fundingToken comes from the runtime config, not the intent.
export const vaultDraftFromCreateIntent = (
  intent: CreateVaultIntent,
  fundingToken: string
): VaultDraft => ({
  ...(intent.mandate === undefined ? {} : { mandate: intent.mandate, operationId: intent.operationId }),
  marketId: intent.marketId,
  question: intent.question,
  outcomeKind: "binary",
  sides: ["yes", "no"],
  resolutionSource: intent.resolutionSource,
  resolutionWindow: { expiresAtMs: intent.resolutionWindowExpiresAtMs },
  fundingToken,
  creatorSide: intent.creatorSide,
  creatorStake: intent.creatorStake,
  seedRate: intent.seedRate
});

export const buildWriteIntentsFromDecision = (
  decision: BookmakerDecision
): readonly BookmakerWriteIntent[] => {
  if (decision.action === "skip") {
    return [];
  }

  if (decision.action === "joinVault") {
    return [
      {
        action: "joinExistingVault",
        marketId: decision.draft.marketId,
        vaultId: decision.vaultId
      }
    ];
  }

  return [buildCreateVaultIntent(decision.draft)];
};
