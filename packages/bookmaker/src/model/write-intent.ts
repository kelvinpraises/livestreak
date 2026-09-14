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
};

export type JoinVaultIntent = {
  readonly action: "joinExistingVault";
  readonly marketId: string;
  readonly vaultId: string;
};

export type BookmakerWriteIntent = CreateVaultIntent | JoinVaultIntent;

export const buildCreateVaultIntent = (draft: VaultDraft): CreateVaultIntent => ({
  action: "createVault",
  marketId: draft.marketId,
  question: draft.question,
  creatorSide: draft.creatorSide ?? "yes",
  creatorStake: draft.creatorStake!,
  seedRate: draft.seedRate!,
  resolutionSource: draft.resolutionSource,
  resolutionWindowExpiresAtMs: draft.resolutionWindow.expiresAtMs
});

// Inverse of buildCreateVaultIntent: the minimal honest VaultDraft an intent carries (the console
// path has no detection/evidence). fundingToken comes from the runtime config, not the intent.
export const vaultDraftFromCreateIntent = (
  intent: CreateVaultIntent,
  fundingToken: string
): VaultDraft => ({
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
